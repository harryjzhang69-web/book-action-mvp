export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export function onRequestGet() {
  // EdgeOne Pages Functions 无持久文件系统，原 Flask 版本基于本地 JSON 统计的
  // 缓存命中数/token 消耗在这里无法保留，返回一个说明性占位结构，前端不会报错。
  return new Response(JSON.stringify({
    cached_books: 0,
    titles: [],
    usage_by_model: {},
    total_tokens: 0,
    total_calls: 0,
    note: '当前部署环境为无状态 Serverless 函数，暂不统计缓存/用量',
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
