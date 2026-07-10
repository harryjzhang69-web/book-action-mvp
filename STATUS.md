# 读书行动派 · 运营状态存档

> 这份文件是给"未来的 AI / 未来的你"看的完整上下文存档。换电脑、换会话，只要读这份文件，就能知道这个产品现在所有的事实状态、决策原因、和还没做完的事，不需要依赖任何聊天记录。
> 最后更新：2026-07-03

---

## 1. 这是什么产品

一句话：帆书解决"我没读过这本书"，这个产品解决"读过之后，我该做什么"。

- 输入书名或拍封面照片 → AI 识别书籍 → 生成基础解读（缓存，多人复用降低成本）
- 用户填身份角色 + 当下具体问题 + 可选的年龄段/MBTI/沟通风格画像 → 生成**个性化**深度解读 + 行动清单
- 可一键生成分享图（深色"浮光幻梦"风格海报，仿网易云年度报告的仪式感）

技术栈：Flask (`app.py`) + 纯前端单页 (`static/index.html`) + glm-4-flash（智谱免费模型）。

## 2. 当前部署状态（务必先看这里，别重复踩坑）

| 项目 | 值 |
|---|---|
| **★ 当前生产环境（推荐，公网可访问）** | EdgeOne Pages，`https://farrahli-59gv2jsp.edgeone.app/` —— 任何人任何网络都能打开，不依赖任何本地/内网服务器，代码见 `eop_deploy/`（Node Functions 运行时，详见该目录 README.md 的架构教训） |
| ~~云服务器（旧方案，已弃用）~~ | AnyDev，环境 ID `anybuildInstance-6k6tqsarg0io`，IP `21.91.155.2:5800` —— **纯内网 IP，公网完全无法访问**，2026-07-10 已确认并弃用，个人网站按钮已改为指向 EdgeOne 地址 |
| GitHub 仓库 | https://github.com/harryjzhang69-web/book-action-mvp （已同步：Flask 原版 `app.py` + EdgeOne 存档版 `eop_deploy/`，均不含真实 API Key） |
| 已挂载在个人网站上 | `personal_site` 的 Case Studies 板块「读书行动派」卡片，「在线体验」按钮已改为跳转 `https://farrahli-59gv2jsp.edgeone.app/` |


**换电脑注意**：`.env`（真实 LLM_API_KEY）不在 GitHub 里，新电脑 `git clone` 下来后本地跑不了，需要照着 `.env.example` 重新填一份。但线上服务（21.91.155.2）跟你电脑无关，不受影响。

## 3. 关键设计决策（为什么这么做）

- **拍封面/输入书名零摩擦**，不需要用户上传全文电子版 —— 规避版权风险，只做"转化式二次创作"（类似书评人讲书）
- **缓存网络效应**：同一本书的"基础解读"缓存复用（`cache/book_cache.json`），第二个读者只需重新生成个性化层，边际成本随用户量下降
- **个性化强制生效**（2026-07-03 修复）：早期版本"补充画像信息（年龄段/MBTI/沟通风格）"写的是"如果为空则忽略"，模型会当成可选建议直接跳过。已改成 `app.py` 里的强制规则块，明确列出每种画像特征必须体现在输出的哪个具体维度（语气开头/举例方式/action颗粒度/外向内向导向），并要求模型自我检查"去掉画像信息内容会不会完全一样"
- **免费模型的真实上限**：A/B 对照测试证明，身份(role)+具体问题(question) 的个性化非常明显；但年龄/MBTI/风格这类软性画像，glm-4-flash 能在"内容颗粒度/叙事手法"上体现差异，但在"语气冷暖"上区分度有限——这是模型能力天花板，不是提示词没写好。如果要更强判别力度，需换更强模型（未来可选项）
- **分享图从固定高度改成动态计算高度**（2026-07-03）：之前 H=1440 固定死，内容一多就挤爆；现在先用一个隐藏 canvas 测量所有文字换行结果，累加各区块高度，再决定画布真实高度
- **分享图内容加厚**（2026-07-03，回应"内容太单一"反馈）：新增 AI 熟读度星级（★★★★☆）、核心洞察引言卡（大引号+一句最有分量的洞察）、行动清单每条加"💭 为什么有效"小字理由、底部仿网易云年度报告的"NO.xxxx 收藏编号"仪式感角标

## 4. 已知问题 / 还没做的事

- [ ] 没有访问限流/防刷机制 —— 如果链接被大量转发，会消耗同一个智谱免费 API Key 的额度，可能被刷爆
- [ ] "复制文案"按钮在 HTTP（非HTTPS）直连IP链接下可能复制失败（浏览器剪贴板API限制），主流程不受影响
- [ ] 想要"好记名字 + HTTPS + 零确认页"三者同时满足，唯一办法是买一个真实域名绑到这台服务器，目前还没做
- [ ] 个性化画像的"语气冷暖"区分度有限（模型能力限制，见上）
- [ ] "和这本书对话"、每日/每周知识卡片推送（企微机器人）、冷门书兜底、订阅制 —— 这些是 V1+ 路线图，都还没开始

## 5. 日常怎么改这个产品（标准流程）

```powershell
# 1. 改代码（本地 c:\Users\Harryjzhang\CodeBuddy\Claw\book_action_mvp\）
# 2. 提交到 GitHub
cd c:\Users\Harryjzhang\CodeBuddy\Claw\book_action_mvp
git add .
git commit -m "说明这次改了什么"
git push

# 3. 想让线上也更新，重新打包上传到 AnyDev：
cd c:\Users\Harryjzhang\CodeBuddy\Claw
Compress-Archive -Path book_action_mvp -DestinationPath book_action_mvp.zip -Force
# 然后用 AnyDev 集成：select_environment → file_upload 到 /data/book_action_mvp.zip
# → webshell: cd /data && unzip -o book_action_mvp.zip && pkill -f app.py; cd book_action_mvp && sudo nohup python3 app.py > app.log 2>&1 &
```
