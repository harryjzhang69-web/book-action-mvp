"""
读书行动派 MVP —— AI 个性化读书知识卡片生成器
核心流程：输入书名/拍封面 → 选角色+当下问题 → 生成"对你有用的解读+行动清单"
不做整书复述，只做转化式二次创作；同一本书做基础解读缓存，降低边际成本。
"""
import os
import json
import re
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv

load_dotenv()

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

BASE_DIR = Path(__file__).parent
CACHE_FILE = BASE_DIR / "cache" / "book_cache.json"
CACHE_FILE.parent.mkdir(exist_ok=True)

API_KEY = os.getenv("LLM_API_KEY", "")
BASE_URL = os.getenv("LLM_BASE_URL", "")
MODEL = os.getenv("LLM_MODEL", "deepseek-chat")
VISION_MODEL = os.getenv("LLM_VISION_MODEL", MODEL)

app = Flask(__name__, static_folder="static", static_url_path="/static")

# CORS：允许 personal-site（GitHub Pages）跨域调用这个后端的 /api/* 接口
# 不引入 flask-cors 依赖，手动加响应头，避免服务器上还要重新装包
ALLOWED_ORIGINS = {
    "https://harryjzhang69-web.github.io",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
}


@app.after_request
def add_cors_headers(resp):
    origin = request.headers.get("Origin", "")
    if origin in ALLOWED_ORIGINS or origin.endswith(".github.io"):
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/api/<path:_any>", methods=["OPTIONS"])
def cors_preflight(_any):
    return "", 204


_client = None


def get_client():
    global _client
    if _client is None and OpenAI is not None and API_KEY:
        _client = OpenAI(api_key=API_KEY, base_url=BASE_URL or None)
    return _client


def load_cache():
    if CACHE_FILE.exists():
        try:
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_cache(cache):
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def norm_title(title: str) -> str:
    return re.sub(r"\s+", "", title or "").strip().lower()


def cache_key(title: str, author: str = "") -> str:
    """书名+作者联合做缓存key，避免同名不同书撞在一起"""
    t = norm_title(title)
    a = norm_title(author)
    return f"{t}::{a}" if a else t


BASE_EXTRACT_PROMPT = """你是一位真正把这本书从头读完、消化透了的资深读书博主，现在要写一份"深度解读"，
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
只输出 JSON 本身，不要任何 markdown 代码块标记或多余文字。"""

PERSONALIZE_PROMPT = """已知一本书的深度解读如下：
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
只输出 JSON 本身，不要任何 markdown 代码块标记或多余文字。"""

IDENTIFY_PROMPT = (
    '这是一张书籍封面照片。请识别出书名和作者，输出 JSON：'
    '{"title": "...", "author": "..."}。如果无法识别，title 留空字符串。只输出 JSON 本身。'
)


def _strip_json_fence(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


USAGE_FILE = BASE_DIR / "cache" / "usage_stats.json"
_usage_lock_data = None


def _load_usage():
    global _usage_lock_data
    if _usage_lock_data is not None:
        return _usage_lock_data
    if USAGE_FILE.exists():
        try:
            _usage_lock_data = json.loads(USAGE_FILE.read_text(encoding="utf-8"))
        except Exception:
            _usage_lock_data = {}
    else:
        _usage_lock_data = {}
    return _usage_lock_data


def _record_usage(model: str, usage):
    """把每次调用的 prompt/completion token 记下来，累计到本地统计文件（简单粗暴，个人项目够用）"""
    if not usage:
        return
    data = _load_usage()
    m = data.setdefault(model, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
    m["calls"] += 1
    m["prompt_tokens"] += getattr(usage, "prompt_tokens", 0) or 0
    m["completion_tokens"] += getattr(usage, "completion_tokens", 0) or 0
    m["total_tokens"] += getattr(usage, "total_tokens", 0) or 0
    try:
        USAGE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


def call_llm_json(prompt: str, image_b64: str = None):
    client = get_client()
    if not client:
        return None
    if image_b64:
        messages = [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
            ],
        }]
        model = VISION_MODEL
    else:
        messages = [{"role": "user", "content": prompt}]
        model = MODEL
    try:
        resp = client.chat.completions.create(
            model=model, messages=messages, temperature=0.6, max_tokens=1200,
        )
        _record_usage(model, getattr(resp, "usage", None))
        text = _strip_json_fence(resp.choices[0].message.content or "")
        try:
            return json.loads(text)
        except Exception:
            m = re.search(r"\{.*\}", text, re.DOTALL)
            if m:
                try:
                    return json.loads(m.group(0))
                except Exception:
                    pass
        return {"_raw": text}
    except Exception as e:
        return {"_error": str(e)}


def identify_book_from_image(image_b64: str):
    return call_llm_json(IDENTIFY_PROMPT, image_b64=image_b64)


@app.route("/api/identify", methods=["POST"])
def api_identify():
    """独立识别接口：拍完封面先识别书名+作者，前端展示给用户确认/修改，再走 /api/generate"""
    data = request.get_json(force=True, silent=True) or {}
    image_b64 = data.get("cover_image")
    if not image_b64:
        return jsonify({"error": "缺少图片"}), 400
    if get_client() is None:
        return jsonify({"error": "未配置模型，无法识别，请切到「输入书名」手动填写", "demo_mode": True}), 200
    ident = identify_book_from_image(image_b64) or {}
    if "_error" in ident:
        return jsonify({"error": f"识别失败：{ident['_error']}"}), 200
    title = (ident.get("title") or "").strip()
    if not title:
        return jsonify({"error": "没识别出书名，换一张更清晰/正对封面的照片，或切到「输入书名」手动填写"}), 200
    return jsonify({"title": title, "author": (ident.get("author") or "").strip()})


def mock_base_extract(title: str):
    return {
        "author": "未知（演示模式）",
        "author_background": "（演示模式）配置真实模型后会生成作者背景介绍",
        "book_structure": ["（演示）第一部分占位", "（演示）第二部分占位"],
        "core_thesis": f"《{title}》的核心观点占位——配置 LLM_API_KEY 后将生成真实解读",
        "key_points": [
            {"point": "演示要点一", "explain": "配置真实模型后，这里会展开解释这个观点背后的逻辑"},
            {"point": "演示要点二", "explain": "同上，演示模式下为占位文字"},
        ],
        "notable_example": "",
        "known_confidence": "low",
    }


def mock_personalize(title: str, role: str, question: str):
    return {
        "deep_analysis": f"（演示模式）配置真实 API Key 后，这里会生成一段具体论证——"
                          f"结合《{title}》的核心观点，说明为什么它能对应到「{role}」当下"
                          f"「{question}」这个具体场景，而不是空泛的套话。",
        "insight_for_you": [
            f"（演示）作为{role}，这本书的观点跟你提到的「{question}」存在关联点一",
            "（演示）关联点二：配置真实模型后会更具体",
        ],
        "action_checklist": [
            {"action": "（演示）这周可以尝试的动作一", "why": "（演示）配置真实模型后会展开原因"},
            {"action": "（演示）明天可以做的动作二", "why": "（演示）配置真实模型后会展开原因"},
        ],
        "one_line_takeaway": "（演示模式）配置真实 API Key 后，这里会生成针对你的一句话总结",
        "share_hook": f"（演示）关于《{title}》的钩子标题",
        "persona_tag": "演示人格标签",
    }


@app.route("/")
def index():
    return send_from_directory(BASE_DIR / "static", "index.html")


@app.route("/api/generate", methods=["POST"])
def api_generate():
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get("book_title") or "").strip()
    author_hint = (data.get("author") or "").strip()
    image_b64 = data.get("cover_image")
    role = (data.get("role") or "普通读者").strip()
    question = (data.get("question") or "还没想好具体问题，先给我通用的启发").strip()

    # 更多个性化画像（全部选填）
    age_range = (data.get("age_range") or "").strip()
    mbti = (data.get("mbti") or "").strip()
    comm_style = (data.get("comm_style") or "").strip()
    extra_bits = []
    if age_range:
        extra_bits.append(f"年龄段：{age_range}")
    if mbti:
        extra_bits.append(f"MBTI：{mbti}")
    if comm_style:
        extra_bits.append(f"沟通/建议偏好：{comm_style}")
    extra_profile = "；".join(extra_bits) or "（未提供）"

    if not title and image_b64:
        ident = identify_book_from_image(image_b64) or {}
        if ident.get("title"):
            title = ident["title"]
            if not author_hint:
                author_hint = (ident.get("author") or "").strip()

    if not title:
        return jsonify({"error": "没有识别到书名，请手动输入书名，或换一张更清晰的封面照片"}), 400

    cache = load_cache()
    key = cache_key(title, author_hint)
    cache_hit = key in cache
    client_available = get_client() is not None

    if cache_hit:
        base = cache[key]
    else:
        author_display = author_hint or "未提供"
        if client_available:
            base = call_llm_json(BASE_EXTRACT_PROMPT.format(title=title, author_hint=author_display)) \
                or mock_base_extract(title)
            if "_error" in base or "_raw" in base:
                base = {**mock_base_extract(title), **{k: v for k, v in base.items() if k not in ("_error", "_raw")}}
        else:
            base = mock_base_extract(title)
        if author_hint:
            base["author"] = author_hint  # 用户/识别结果给的作者优先，不让模型自由发挥
        cache[key] = base
        save_cache(cache)

    if client_available:
        key_points_detail = "；".join(
            f"{kp.get('point','')}（{kp.get('explain','')}）" if isinstance(kp, dict) else str(kp)
            for kp in (base.get("key_points", []) or [])
        )
        personalized = call_llm_json(PERSONALIZE_PROMPT.format(
            title=title,
            author=base.get("author", "未知"),
            author_background=base.get("author_background", "") or "（未知）",
            book_structure="；".join(base.get("book_structure", []) or []) or "（未知）",
            core_thesis=base.get("core_thesis", ""),
            key_points_detail=key_points_detail or "（未知）",
            notable_example=base.get("notable_example", "") or "（无）",
            role=role, question=question, extra_profile=extra_profile,
        )) or mock_personalize(title, role, question)
        if "_error" in personalized or "_raw" in personalized:
            personalized = mock_personalize(title, role, question)
    else:
        personalized = mock_personalize(title, role, question)

    return jsonify({
        "title": title,
        "author": base.get("author", "未知"),
        "author_background": base.get("author_background", "") or "",
        "book_structure": base.get("book_structure", []) or [],
        "core_thesis": base.get("core_thesis", ""),
        "key_points": base.get("key_points", []) or [],
        "notable_example": base.get("notable_example", "") or "",
        "known_confidence": base.get("known_confidence", "low"),
        "cache_hit": cache_hit,
        "deep_analysis": personalized.get("deep_analysis", ""),
        "insight_for_you": personalized.get("insight_for_you", []) or [],
        "action_checklist": personalized.get("action_checklist", []) or [],
        "one_line_takeaway": personalized.get("one_line_takeaway", ""),
        "share_hook": personalized.get("share_hook", "") or f"《{title}》给你的行动清单",
        "persona_tag": personalized.get("persona_tag", "") or "读书行动派",
        "demo_mode": not client_available,
    })


@app.route("/api/cache_stats")
def api_cache_stats():
    cache = load_cache()
    usage = _load_usage()
    total_tokens = sum(m.get("total_tokens", 0) for m in usage.values())
    total_calls = sum(m.get("calls", 0) for m in usage.values())
    return jsonify({
        "cached_books": len(cache),
        "titles": list(cache.keys()),
        "usage_by_model": usage,
        "total_tokens": total_tokens,
        "total_calls": total_calls,
    })


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5800"))
    print(f"读书行动派 MVP 启动: http://127.0.0.1:{port}")
    print(f"LLM 配置状态: {'已配置真实模型' if get_client() else '未配置 -> 演示模式（请设置 .env 中的 LLM_API_KEY）'}")
    app.run(host="0.0.0.0", port=port, debug=True, use_reloader=False)
