// 共享模块：prompts + LLM 调用逻辑（从原 Flask app.py 逐字段迁移）
// 注意：EdgeOne Pages Functions 无持久化文件系统，因此原来的本地 JSON 缓存
// （cache/book_cache.json、usage_stats.json）在这里被省略，改为每次都重新调用模型。
// 对个人 MVP 级别流量而言这是可接受的取舍。

export const BASE_EXTRACT_PROMPT = `你是一位真正把这本书从头读完、消化透了的资深读书博主，现在要写一份"深度解读"，
必须让读者感觉到你是读完整本书之后总结的，而不是只看了封面/豆瓣简介就在编。
书名：《{title}》
作者线索：{author_hint}（如果这条信息是"未提供"，请你自己判断最可能的作者；如果已提供，请以此为准，不要输出别的作者）

要求：
- 不要逐段复述原文，用自己的话做转化式的深度解读，但内容要具体、有实质信息，不能是空话套话
- 书名可能撞名（多个不同作者写过同名书），请优先参考作者线索来判断具体是哪一本
- 如果你对这本书信息有限/不熟悉，必须在 known_confidence 里如实标注为 low，且不要编造具体情节、数据、人名、案例——宁可少说，不能编
- 输出 JSON，字段：
  author：作者（若作者线索已提供则原样返回，若未提供且你也不确定则填"未知"）
  author_background：作者是谁、大致背景、为什么写这本书/想解决什么问题（1-2句话，不确定就填空字符串，不要编）
  book_structure：这本书大致的论述结构，3-5条字符串数组，每条格式类似"第一部分讲...，第二部分讲..."，
    体现出你清楚这本书是怎么组织展开的，不是随便列几个关键词
  core_thesis：这本书最核心的论点，可以是1-2句话，要有信息量，不能只是书名换个说法
  key_points：核心观点数组，3-5个对象，每个对象包含：
    point（观点本身，不超过20字）
    explain（展开解释这个观点背后的逻辑/为什么成立/书里怎么论证的，60-100字，要有实质内容，不能是废话重复point）
  notable_example：书中一个你确实知道的有代表性的案例/故事/比喻的简述（不知道就填空字符串，绝对不能编造）
  known_confidence："high"/"medium"/"low"，表示你对这本书的真实熟悉程度，必须如实评估
只输出 JSON 本身，不要任何 markdown 代码块标记或多余文字。`;

export const PERSONALIZE_PROMPT = `已知一本书的深度解读如下：
书名：《{title}》
作者：{author}
作者背景：{author_background}
书籍结构：{book_structure}
核心论点：{core_thesis}
核心观点详解：{key_points_detail}
代表性案例：{notable_example}

现在有一位读者，身份是【{role}】，他当下遇到的具体问题/场景是：【{question}】
补充画像信息：{extra_profile}

【强制规则，必须执行，不是可选建议】
如果补充画像信息不是"（未提供）"，你必须做到：
1. 在 deep_analysis 的行文语气里，明显体现这些特征——不是提一下就算了，而是从头到尾用这种语气写：
   - 如果风格偏好包含"喜欢案例"：deep_analysis 必须包含至少一个具体的比喻或场景化描述，不能只讲道理
   - 如果风格偏好包含"多鼓励少说教"：deep_analysis 开头必须是肯定/共情的语气（如"你现在的困惑很正常/很多人也会遇到这个阶段"），不能一上来就讲道理
   - 如果风格偏好包含"步骤要细"：action_checklist 每条 action 必须拆到"打开什么工具/写下什么/花多久"这种具体到分钟级的颗粒度
   - 如果风格偏好包含"直接给结论"：deep_analysis 第一句话必须是结论本身，不能先铺垫
   - 如果 MBTI 以"I"开头（内向）：action_checklist 不能出现"主动找人聊/组织聚会/公开演讲"这类外向导向动作，换成书面/独立完成的动作
   - 如果 MBTI 以"E"开头（外向）：可以放心建议"找人讨论/公开分享"这类动作
   - 如果年龄段是"18-24岁"或"18岁以下"：举例和语言要更年轻化、口语化，避免"职业发展规划""KPI"这类偏成熟职场的词汇
   - 如果年龄段是"35岁以上"：可以更直接、更少解释背景知识
2. 生成完之后自我检查：如果去掉这些画像信息，deep_analysis 的语气/举例会不会完全一样？如果一样，说明你没有真正使用这些信息，必须重写

请你作为一位真正读懂这本书、又懂产品思维的读书教练，写一份"深度个性化解读"，要求：
- deep_analysis：一段150-250字的深度论证，必须具体引用上面书籍解读里提到的观点/逻辑/案例（点名说是哪个观点），
  讲清楚"为什么这本书的这个机制/逻辑能对应到他的具体场景"，要有真实的推理链条，
  不能写成"这本书会帮到你"这种空话——如果书籍信息本身就有限（known_confidence是low），
  要诚实说明这一点，用能确定的核心论点去做推断，而不是硬编细节
- insight_for_you：2-3条，每条是具体的"书中的哪个观点 → 对应他场景的哪个部分"（每条不超过70字的字符串数组）
- action_checklist：3-5个对象，每个对象包含：
  action（具体动作，以动词开头，不超过40字）
  why（这个动作为什么有效，跟书里哪个逻辑/观点相关，不超过50字）
- one_line_takeaway：一句话总结，如果他只记住一句话该记住什么
- share_hook：一句**不超过15个字**的强钩子标题，用于生成分享卡片的封面大标题，要能让没读过这本书的人也想点开看，
  句式参考"情绪型"（如"后悔没早点读到"）/"数字型"（如"3句话讲透xx"）/"身份认同型"（如"打工人必看"）/"反差型"（如"读完却没做到，等于白读"），
  要跟这本书+这位读者的场景相关，不能是空泛的通用句子
- persona_tag：给这位读者生成一个**4-6个字**的人格化称号（模仿"年度歌单人格标签"的手法，把抽象的阅读行为具象成一个有辨识度、
  会让人想截图分享的身份标签），要结合他的角色/这本书的观点/当下场景，风格可以俏皮或有力量感，
  例如"细节控行动派""破局思考者""温柔的执行力""反内耗实践家"，不能是"读者"这种空泛称呼

输出 JSON，字段：deep_analysis（字符串）、insight_for_you（字符串数组）、
action_checklist（对象数组，每个对象含action和why）、one_line_takeaway（字符串）、share_hook（字符串）、persona_tag（字符串）
只输出 JSON 本身，不要任何 markdown 代码块标记或多余文字。`;

// 合并版 Prompt：把"基础解读"+"个性化解读"合成一次模型调用完成。
// 原因：/api/generate 原来顺序调用 2 次模型，单次耗时 15~45s，两次叠加经常
// 逼近/超过执行时长上限，导致第二次调用被强制掐断——这才是
// "随机看起来不稳定"的真正根因（14本书压测命中 78.6% 失败率，且全部精确卡在
// 超时阈值上，并非模型或网络随机波动）。合并成一次调用后总耗时直接减半。
// 2026-07-10 已切换到 Node Functions 运行时（执行时长配额远高于 Edge Functions
// 的~15s硬限制），不再需要为了赶超时把内容压得很短，因此把字段长度要求恢复/
// 加强到"内容详实"的水平（书籍结构/核心观点数量和篇幅都放大），换取更有信息量
// 的深度解读，而不是过去那种"精炼到没内容"的短版本。
export const COMBINED_PROMPT = `你是一位真正把这本书从头读完、消化透了的资深读书博主，兼具产品思维的读书教练，正在给读者写一份详实、有信息密度的深度解读，而不是一份内容单薄的摘要卡片。
书名：《{title}》
作者线索：{author_hint}（如果这条信息是"未提供"，请你自己判断最可能的作者；如果已提供，请以此为准，不要输出别的作者）

现在有一位读者，身份是【{role}】，他当下遇到的具体问题/场景是：【{question}】
补充画像信息：{extra_profile}

请你分两部分输出，一次性完成。两部分都要写得具体、扎实、信息量足，不要用空话套话去凑字数，也不要为了简短而牺牲实质内容：

【第一部分：书籍深度解读】
- 不要逐段复述原文，用自己的话做转化式的深度解读；要让读者感觉到你是真正读完整本书、消化过内容之后写的，而不是看了豆瓣简介在编
- 书名可能撞名（多个不同作者写过同名书），请优先参考作者线索来判断具体是哪一本
- 如果你对这本书信息有限/不熟悉，必须在 known_confidence 里如实标注为 low，且不要编造具体情节、数据、人名、案例——宁可少说，不能编
- book_structure 要体现出这本书真实的论述脉络（比如"第一部分先破除xx的误区，第二部分提出xx框架，第三部分用xx案例验证"），不能只是罗列几个孤立关键词
- key_points 每一条 explain 都要讲清楚"这个观点背后的逻辑是什么、书里是怎么论证/举例支撑的"，要有实质推理过程，不能只是把 point 换个说法重复一遍

【第二部分：针对这位读者的个性化解读】
如果补充画像信息不是"（未提供）"，你必须做到：
- 如果风格偏好包含"喜欢案例"：deep_analysis 必须包含至少一个具体的比喻或场景化描述，不能只讲道理
- 如果风格偏好包含"多鼓励少说教"：deep_analysis 开头必须是肯定/共情的语气，不能一上来就讲道理
- 如果风格偏好包含"步骤要细"：action_checklist 每条 action 必须拆到"打开什么工具/写下什么/花多久"这种具体到分钟级的颗粒度
- 如果风格偏好包含"直接给结论"：deep_analysis 第一句话必须是结论本身，不能先铺垫
- 如果 MBTI 以"I"开头（内向）：action_checklist 不能出现"主动找人聊/组织聚会/公开演讲"这类外向导向动作，换成书面/独立完成的动作
- 如果 MBTI 以"E"开头（外向）：可以放心建议"找人讨论/公开分享"这类动作
- 如果年龄段是"18-24岁"或"18岁以下"：举例和语言要更年轻化、口语化
- 如果年龄段是"35岁以上"：可以更直接、更少解释背景知识
deep_analysis 必须是一段有真实推理链条的深度论证：具体引用第一部分提到的至少1-2个观点/逻辑/案例（点名说是哪个观点），一步步讲清楚"这本书的这个机制/逻辑，为什么、以及如何能对应到他当下这个具体场景"，要有因果关系和展开分析，不能写成"这本书会帮到你"这种空话——如果书籍信息本身就有限（known_confidence是low），要诚实说明这一点，用能确定的核心论点去做推断，而不是硬编细节。

只输出一个 JSON 对象本身，不要任何 markdown 代码块标记或多余文字，字段如下：
{
  "author": "作者（若作者线索已提供则原样返回，若未提供且你也不确定则填未知）",
  "author_background": "作者是谁、大致背景、为什么写这本书/想解决什么问题，2-3句话，要有具体信息（不确定就填空字符串，不要编）",
  "book_structure": ["这本书大致的论述结构，4-5条字符串，每条30-50字，要体现真实的论述脉络和逻辑递进关系，不是罗列关键词"],
  "core_thesis": "这本书最核心的论点，1-2句话，要有信息量，不能只是书名换个说法",
  "key_points": [{"point": "观点本身，不超过20字", "explain": "展开解释这个观点背后的逻辑、书里怎么论证/举例支撑的，80-120字，要有实质内容"}],
  "notable_example": "书中一个确实知道的代表性案例/故事/比喻，具体展开50-80字（不知道就填空字符串，不能编造）",
  "known_confidence": "high/medium/low，如实评估你对这本书的真实熟悉程度",
  "deep_analysis": "200-280字的深度个性化论证，要有真实的推理链条和展开分析，不能空洞",
  "insight_for_you": ["3条，每条具体的'书中的哪个观点 → 对应他场景的哪个部分，为什么'，50-70字"],
  "action_checklist": [{"action": "具体动作，动词开头，不超过35字", "why": "为什么有效，跟书里哪个逻辑/观点相关，不超过45字"}],
  "one_line_takeaway": "一句话总结，如果他只记住一句话该记住什么，不超过40字",
  "share_hook": "不超过15个字的强钩子标题，用于分享卡片封面大标题",
  "persona_tag": "4-6个字的人格化称号，例如'细节控行动派''破局思考者'，不能是'读者'这种空泛称呼"
}
key_points 恰好4个对象，action_checklist 恰好4个对象。内容要详实具体，避免过度精简导致信息量不足。`;

export const IDENTIFY_PROMPT =
  '这是一张书籍封面照片。请识别出书名和作者，输出 JSON：' +
  '{"title": "...", "author": "..."}。如果无法识别，title 留空字符串。只输出 JSON 本身。';

export function fmt(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
}

export function stripJsonFence(text) {
  let t = (text || '').trim();
  t = t.replace(/^```(json)?\s*/i, '');
  t = t.replace(/\s*```$/, '');
  return t.trim();
}

export function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    ...extra,
  };
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
}

/**
 * 调用 OpenAI 协议兼容的 LLM 接口，返回解析后的 JSON 对象。
 * env 需要包含：LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_VISION_MODEL
 */
// 安全说明（GitHub 存档版本，不含真实密钥）：
// 部署到 EdgeOne Pages 时，必须在控制台「项目设置 → 环境变量」里配置
// LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_VISION_MODEL 四个变量，
// 代码本身不再内置任何真实密钥兜底值，避免密钥随源码泄露到公开仓库。
const DEFAULT_LLM_API_KEY = '';
const DEFAULT_LLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_LLM_MODEL = 'glm-4-flash';
const DEFAULT_LLM_VISION_MODEL = 'glm-4v-flash';

export async function callLlmJson(env, prompt, imageB64 = null, options = {}) {
  const apiKey = (env && env.LLM_API_KEY) || DEFAULT_LLM_API_KEY;
  if (!apiKey) return null;
  const baseUrl = ((env && env.LLM_BASE_URL) || DEFAULT_LLM_BASE_URL).replace(/\/$/, '');
  const model = imageB64
    ? ((env && env.LLM_VISION_MODEL) || (env && env.LLM_MODEL) || DEFAULT_LLM_VISION_MODEL)
    : ((env && env.LLM_MODEL) || DEFAULT_LLM_MODEL);

  let messages;
  if (imageB64) {
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageB64}` } },
      ],
    }];
  } else {
    messages = [{ role: 'user', content: prompt }];
  }

  // 实测直连模型 API 单次响应耗时约 15~45 秒（模型本身较慢，非网络故障）。
  // 关键教训：/api/generate 之前顺序调用 2 次模型（基础解读 + 个性化），两次
  // 耗时叠加经常逼近/超过云函数执行上限，第二次调用被强制掐断——这才是
  // "随机看起来不稳定"的真正根因（14本书压测命中 78.6% 失败率，且全部精确
  // 卡在超时阈值上）。已把两次调用合并成一次（见 generate.js），这里的默认
  // 超时/重试参数按"单次调用"场景设置，允许调用方按需覆盖（如 identify 场景
  // 输出很短，可以用更短超时+更多重试）。
  const maxTokens = options.maxTokens || 3000;
  const timeoutMs = options.timeoutMs || 100000; // 单次调用留足 100s，云函数上限 120s
  const maxAttempts = options.maxAttempts || 1; // 默认不重试，避免多次调用叠加超过云函数上限
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, temperature: 0.6, max_tokens: maxTokens }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await resp.json();
      if (!resp.ok) {
        lastError = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
        continue; // 服务端返回错误（如限流），重试
      }
      const finishReason = data.choices?.[0]?.finish_reason;
      const text = stripJsonFence(data.choices?.[0]?.message?.content || '');
      try {
        return JSON.parse(text);
      } catch (e) {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          try { return JSON.parse(m[0]); } catch (e2) { /* fallthrough */ }
        }
        lastError = `模型输出被截断或格式异常（finish_reason=${finishReason}）`;
        continue;
      }
    } catch (e) {
      lastError = String(e && e.message ? e.message : e);
      // 网络类错误（超时/连接失败），继续下一次重试
    }
  }
  return { _error: lastError || '多次重试后仍失败' };
}

export function mockBaseExtract(title) {
  return {
    author: '未知（演示模式）',
    author_background: '（演示模式）配置真实模型后会生成作者背景介绍',
    book_structure: ['（演示）第一部分占位', '（演示）第二部分占位'],
    core_thesis: `《${title}》的核心观点占位——配置 LLM_API_KEY 后将生成真实解读`,
    key_points: [
      { point: '演示要点一', explain: '配置真实模型后，这里会展开解释这个观点背后的逻辑' },
      { point: '演示要点二', explain: '同上，演示模式下为占位文字' },
    ],
    notable_example: '',
    known_confidence: 'low',
  };
}

export function mockPersonalize(title, role, question) {
  return {
    deep_analysis: `（演示模式）配置真实 API Key 后，这里会生成一段具体论证——` +
      `结合《${title}》的核心观点，说明为什么它能对应到「${role}」当下` +
      `「${question}」这个具体场景，而不是空泛的套话。`,
    insight_for_you: [
      `（演示）作为${role}，这本书的观点跟你提到的「${question}」存在关联点一`,
      '（演示）关联点二：配置真实模型后会更具体',
    ],
    action_checklist: [
      { action: '（演示）这周可以尝试的动作一', why: '（演示）配置真实模型后会展开原因' },
      { action: '（演示）明天可以做的动作二', why: '（演示）配置真实模型后会展开原因' },
    ],
    one_line_takeaway: '（演示模式）配置真实 API Key 后，这里会生成针对你的一句话总结',
    share_hook: `（演示）关于《${title}》的钩子标题`,
    persona_tag: '演示人格标签',
  };
}

// 合并版 mock：字段与 COMBINED_PROMPT 的输出结构完全对齐。
export function mockCombined(title, role, question) {
  return { ...mockBaseExtract(title), ...mockPersonalize(title, role, question) };
}
