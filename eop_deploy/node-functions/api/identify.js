import { IDENTIFY_PROMPT, callLlmJson, corsHeaders, jsonResponse } from '../_shared.js';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const data = await request.json().catch(() => ({}));
  const imageB64 = data.cover_image;
  if (!imageB64) {
    return jsonResponse({ error: '缺少图片' }, 400);
  }
  const ident = (await callLlmJson(env, IDENTIFY_PROMPT, imageB64, {
    maxTokens: 200, timeoutMs: 30000, maxAttempts: 2,
  })) || {};
  if (ident._error) {
    return jsonResponse({ error: `识别失败：${ident._error}` }, 200);
  }
  const title = (ident.title || '').trim();
  if (!title) {
    return jsonResponse({ error: '没识别出书名，换一张更清晰/正对封面的照片，或切到「输入书名」手动填写' }, 200);
  }
  return jsonResponse({ title, author: (ident.author || '').trim() });
}
