import {
  COMBINED_PROMPT, IDENTIFY_PROMPT, fmt, callLlmJson,
  mockCombined, corsHeaders, jsonResponse,
} from '../_shared.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const data = await request.json().catch(() => ({}));

  let title = (data.book_title || '').trim();
  let authorHint = (data.author || '').trim();
  const imageB64 = data.cover_image;
  const role = (data.role || '普通读者').trim();
  const question = (data.question || '还没想好具体问题，先给我通用的启发').trim();

  const ageRange = (data.age_range || '').trim();
  const mbti = (data.mbti || '').trim();
  const commStyle = (data.comm_style || '').trim();
  const extraBits = [];
  if (ageRange) extraBits.push(`年龄段：${ageRange}`);
  if (mbti) extraBits.push(`MBTI：${mbti}`);
  if (commStyle) extraBits.push(`沟通/建议偏好：${commStyle}`);
  const extraProfile = extraBits.length ? extraBits.join('；') : '（未提供）';

  if (!title && imageB64) {
    // 拍封面识别书名：输出很短，用较短超时+多次重试更划算。
    const ident = (await callLlmJson(env, IDENTIFY_PROMPT, imageB64, {
      maxTokens: 200, timeoutMs: 30000, maxAttempts: 2,
    })) || {};
    if (ident.title) {
      title = ident.title;
      if (!authorHint) authorHint = (ident.author || '').trim();
    }
  }

  if (!title) {
    return jsonResponse({ error: '没有识别到书名，请手动输入书名，或换一张更清晰的封面照片' }, 400);
  }

  // 关键修复：原来这里顺序调用 2 次模型（基础解读 + 个性化解读），
  // 单次耗时 15~45s，两次叠加经常超过云函数执行时长上限，第二次调用
  // 被强制掐断——这是压测发现的"78.6%失败率、精确卡在超时阈值"的根因，
  // 跟哪本书、跟网络稳定性都无关。现在合并成一次调用，总耗时直接减半。
  // 2026-07-10：已切换到 Node Functions 运行时（执行时长配额远高于此前的
  // ~15s Edge Functions 硬限制），因此把 maxTokens 从 1500 提到 3000，
  // 配合 COMBINED_PROMPT 里恢复的"详实"字数要求，避免内容被压得太短/被截断。
  const authorDisplay = authorHint || '未提供';
  let result = await callLlmJson(env, fmt(COMBINED_PROMPT, {
    title,
    author_hint: authorDisplay,
    role, question, extra_profile: extraProfile,
  }), null, { maxTokens: 3000, timeoutMs: 100000, maxAttempts: 1 });

  const clientAvailable = !(result && result._error);
  if (!result || result._error) {
    result = mockCombined(title, role, question);
  }
  if (authorHint) result.author = authorHint;

  return jsonResponse({
    title,
    author: result.author || '未知',
    author_background: result.author_background || '',
    book_structure: result.book_structure || [],
    core_thesis: result.core_thesis || '',
    key_points: result.key_points || [],
    notable_example: result.notable_example || '',
    known_confidence: result.known_confidence || 'low',
    cache_hit: false,
    deep_analysis: result.deep_analysis || '',
    insight_for_you: result.insight_for_you || [],
    action_checklist: result.action_checklist || [],
    one_line_takeaway: result.one_line_takeaway || '',
    share_hook: result.share_hook || `《${title}》给你的行动清单`,
    persona_tag: result.persona_tag || '读书行动派',
    demo_mode: !clientAvailable,
  });
}
