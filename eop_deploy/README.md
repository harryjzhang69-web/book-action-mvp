# 读书行动派 MVP —— EdgeOne Pages 全栈部署版（存档，2026-07-10）

原 Flask (`app.py`) 版本迁移到 EdgeOne Pages **Node Functions** 运行时，
获得真正公网可访问、免维护服务器的 HTTPS 网址。

**线上地址**：https://farrahli-59gv2jsp.edgeone.app/

## 目录结构

```
eop_deploy/
  index.html                  # 前端单页（与原版一致，未改动），必须放在项目根目录（不是 public/ 子目录）
  edgeone.json                 # 项目配置（项目名 + cloudFunctions.nodejs.maxDuration）
  node-functions/              # 注意：必须叫 node-functions，不能叫 functions
    _shared.js                # 共享：prompts + LLM 调用逻辑
    api/identify.js           # POST /api/identify  拍封面识别书名作者
    api/generate.js           # POST /api/generate   核心：生成个性化解读（合并调用，见下）
    api/cache_stats.js        # GET  /api/cache_stats 用量统计（无状态占位）
```

## 关键架构教训（务必先看，别重蹈覆辙）

1. **函数目录必须叫 `node-functions/`，不能叫 `functions/`**——EdgeOne Pages 会把
   `functions/` 目录识别成 **Edge Functions** 运行时，这个运行时有一个**约15秒的
   硬性执行超时，无法通过任何配置延长**。而调用大模型生成内容正常就要
   15~45秒，天然超过这个上限，会导致请求"随机看起来不稳定"（实测14本书压测
   命中78.6%失败率，且全部精确卡在超时阈值上）。
   `node-functions/` 才是 **Node Functions** 运行时，执行时长配额可以通过
   `edgeone.json` 里的 `cloudFunctions.nodejs.maxDuration` 配置放宽（当前设为120秒）。
2. **两次模型调用要合并成一次**：`/api/generate` 原来顺序调用2次模型（基础
   解读+个性化解读），单次耗时叠加很容易超时。已改成 `COMBINED_PROMPT`
   一次性生成全部字段。
3. **`callLlmJson` 的默认 `maxAttempts=1`（不重试）**：因为单次调用已经要
   60~90秒，重试会让总耗时轻易超过云函数执行上限，反而更容易失败。

## 与原 Flask 版本的差异

1. **无持久文件缓存**：原版 `cache/book_cache.json`（同书复用基础解读）在
   Serverless 函数环境下不存在持久文件系统，这里改为每次都重新调用模型生成。
2. **无本地 usage 统计**：`/api/cache_stats` 返回占位数据，不影响前端展示逻辑。
3. **CORS 放开为 `*`**：前端与后端同域部署，实际请求不会跨域，放开只是为了兼容性。

## 部署前必须配置的环境变量

在 EdgeOne Pages 控制台的项目设置里添加（**本仓库代码不含任何真实密钥**，
`_shared.js` 里的默认值是空字符串占位，必须在控制台配置才能正常工作）：

| 变量名 | 说明 | 示例 |
|---|---|---|
| `LLM_API_KEY` | 大模型 API Key（必填，否则进入演示模式） | 你自己的智谱/DeepSeek等 Key |
| `LLM_BASE_URL` | OpenAI 协议兼容的 Base URL | `https://open.bigmodel.cn/api/paas/v4` |
| `LLM_MODEL` | 文本模型 | `glm-4-flash` |
| `LLM_VISION_MODEL` | 多模态模型（拍封面识别用） | `glm-4v-flash` |

配置后在控制台点 Redeploy，或者用 EdgeOne Pages CLI/MCP 工具重新执行一次部署。

## 原项目来源

- GitHub: https://github.com/harryjzhang69-web/book-action-mvp
- 原部署（内网，仅供参考对照，已弃用）：http://21.91.155.2:5800/
