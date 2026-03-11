"""AI 智能助手路由 — 集成千问 Qwen3.5-plus（Responses API + Thinking）"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import text
from datetime import date, timedelta
import json, asyncio

from app.database import get_db
from app.middleware.auth import get_current_user, require_admin
from app.models.user import User

router = APIRouter(prefix="/ai", tags=["AI"])

DASHSCOPE_API_KEY = "sk-b121d7a1020f4c4e9740ec130f359333"
DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DASHSCOPE_RESPONSES_URL = "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1"
QWEN_MODEL = "qwen-plus"
QWEN_THINKING_MODEL = "qwen3.5-plus"


def _get_openai_client():
    from openai import OpenAI
    return OpenAI(api_key=DASHSCOPE_API_KEY, base_url=DASHSCOPE_BASE_URL)


def _get_responses_client():
    from openai import OpenAI
    return OpenAI(api_key=DASHSCOPE_API_KEY, base_url=DASHSCOPE_RESPONSES_URL)


def _as_int(value) -> int:
    return int(value or 0)


def _as_float(value) -> float:
    return float(value or 0)


def _build_today_business_context(db: Session) -> str:
    """补充今日实时业务数据，降低AI编造数据的概率"""
    today = date.today()
    week_start = today - timedelta(days=6)
    ctx_parts = []
    outbound_count = 0
    printed_count = 0

    try:
        r = db.execute(text("""
            SELECT COUNT(*) AS cnt,
                   COALESCE(SUM(actual_weight), 0) AS actual_weight,
                   COALESCE(SUM(estimated_weight), 0) AS estimated_weight
            FROM printed_labels
            WHERE scanned_outbound > 0
              AND DATE(scanned_time) = :today
        """), {"today": today}).mappings().first()
        outbound_count = _as_int(r["cnt"])
        actual_weight = _as_float(r["actual_weight"])
        estimated_weight = _as_float(r["estimated_weight"])
        ctx_parts.append(
            f"今日出库实时: 出库标签{outbound_count}张, 实际重量{actual_weight:.2f}kg, 应有重量{estimated_weight:.2f}kg"
        )
    except Exception:
        pass

    try:
        r = db.execute(text("""
            SELECT COUNT(*) AS cnt
            FROM printed_labels
            WHERE DATE(created_at) = :today
        """), {"today": today}).mappings().first()
        printed_count = _as_int(r["cnt"])
        loss_count = max(printed_count - outbound_count, 0)
        loss_rate = (loss_count / printed_count * 100) if printed_count else 0
        ctx_parts.append(
            f"今日打印实时: 打印标签{printed_count}张, 按打印-出库口径损耗{loss_count}张, 损耗率{loss_rate:.1f}%"
        )
    except Exception:
        pass

    try:
        rows = db.execute(text("""
            SELECT COALESCE(NULLIF(TRIM(s.fruit_name), ''), f.name, '未知水果') AS fruit_name,
                   COUNT(*) AS cnt
            FROM printed_labels pl
            LEFT JOIN sku s ON pl.s = s.id
            LEFT JOIN fruits f ON s.fruit_id = f.id
            WHERE pl.scanned_outbound > 0
              AND DATE(pl.scanned_time) = :today
            GROUP BY COALESCE(NULLIF(TRIM(s.fruit_name), ''), f.name, '未知水果')
            ORDER BY cnt DESC
            LIMIT 5
        """), {"today": today}).mappings().all()
        if rows:
            total = sum(_as_int(r["cnt"]) for r in rows) or 1
            mix = ", ".join([
                f"{r['fruit_name']}({_as_int(r['cnt'])}张/{_as_int(r['cnt']) * 100 / total:.1f}%)"
                for r in rows
            ])
            ctx_parts.append(f"今日出库水果分布: {mix}")
        else:
            ctx_parts.append("今日出库水果分布: 今日无出库记录")
    except Exception:
        pass

    try:
        rows = db.execute(text("""
            SELECT DATE(scanned_time) AS d, COUNT(*) AS cnt
            FROM printed_labels
            WHERE scanned_outbound > 0
              AND DATE(scanned_time) BETWEEN :start_date AND :end_date
            GROUP BY DATE(scanned_time)
        """), {"start_date": week_start, "end_date": today}).mappings().all()
        day_map = {r["d"]: _as_int(r["cnt"]) for r in rows}
        daily_counts = [day_map.get(week_start + timedelta(days=i), 0) for i in range(7)]
        avg_daily = sum(daily_counts) / 7
        ctx_parts.append(f"近7天日均出库标签数(含无出库日): {avg_daily:.1f}")
    except Exception:
        pass

    try:
        r = db.execute(text("""
            SELECT SUM(CASE WHEN audit_status = 'pending' THEN 1 ELSE 0 END) AS pending_cnt,
                   SUM(CASE WHEN audit_status = 'approved' THEN 1 ELSE 0 END) AS approved_cnt,
                   SUM(CASE WHEN audit_status = 'rejected' THEN 1 ELSE 0 END) AS rejected_cnt
            FROM worker_production
            WHERE production_date = :today
        """), {"today": today}).mappings().first()
        ctx_parts.append(
            f"今日生产审核状态: 待审{_as_int(r['pending_cnt'])}条, 已通过{_as_int(r['approved_cnt'])}条, 已驳回{_as_int(r['rejected_cnt'])}条"
        )
    except Exception:
        pass

    return "\n".join(ctx_parts)


def _build_business_context(db: Session) -> str:
    """从数据库拉取实时业务摘要作为AI上下文"""
    today = date.today()
    week_ago = today - timedelta(days=7)
    ctx_parts = []

    try:
        r = db.execute(text("""
            SELECT COUNT(*) as cnt, COALESCE(SUM(purchase_price * purchase_weight),0) as amt
            FROM fruit_purchases WHERE deleted_at IS NULL
        """)).mappings().first()
        ctx_parts.append(f"水果采购: 共{r['cnt']}笔, 总金额{float(r['amt']):.0f}元")
    except Exception:
        pass

    try:
        r = db.execute(text("""
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN scanned_outbound>0 THEN 1 ELSE 0 END) as outbound,
                   SUM(CASE WHEN scanned_outbound=0 THEN 1 ELSE 0 END) as instock
            FROM printed_labels
        """)).mappings().first()
        ctx_parts.append(f"标签总数: {r['total']}, 已出库: {r['outbound']}, 在库: {r['instock']}")
    except Exception:
        pass

    today_ctx = _build_today_business_context(db)
    if today_ctx:
        ctx_parts.append(f"今日实时数据:\n{today_ctx}")

    try:
        r = db.execute(text("""
            SELECT COUNT(*) as cnt FROM printed_labels
            WHERE scanned_outbound>0 AND DATE(scanned_time) >= :wa
        """), {"wa": week_ago}).mappings().first()
        ctx_parts.append(f"近7天累计出库标签: {r['cnt']}个")
    except Exception:
        pass

    try:
        rows = db.execute(text("""
            SELECT u.real_name, COUNT(pl.id) as cnt
            FROM printed_labels pl JOIN users u ON pl.u=u.id
            WHERE pl.scanned_outbound>0 AND DATE(pl.scanned_time) >= :wa
            GROUP BY pl.u ORDER BY cnt DESC LIMIT 5
        """), {"wa": week_ago}).mappings().all()
        if rows:
            top = ", ".join([f"{r['real_name']}({r['cnt']})" for r in rows])
            ctx_parts.append(f"近7天出库排行: {top}")
    except Exception:
        pass

    try:
        rows = db.execute(text("""
            SELECT u.real_name,
                   SUM(CASE WHEN wp.audit_status='pending' THEN 1 ELSE 0 END) as pending,
                   SUM(CASE WHEN wp.audit_status='approved' THEN 1 ELSE 0 END) as approved
            FROM worker_production wp JOIN users u ON wp.worker_id=u.id
            GROUP BY wp.worker_id ORDER BY approved DESC LIMIT 5
        """)).mappings().all()
        if rows:
            prod = ", ".join([f"{r['real_name']}(已审{r['approved']}/待审{r['pending']})" for r in rows])
            ctx_parts.append(f"工人生产概况: {prod}")
    except Exception:
        pass

    try:
        r = db.execute(text("""
            SELECT COUNT(*) as cnt FROM worker_production WHERE audit_status='pending'
        """)).mappings().first()
        ctx_parts.append(f"待审核生产记录: {r['cnt']}条")
    except Exception:
        pass

    try:
        rows = db.execute(text("""
            SELECT f.name, COUNT(s.id) as sku_cnt
            FROM sku s JOIN fruits f ON s.fruit_id=f.id
            GROUP BY s.fruit_id ORDER BY sku_cnt DESC LIMIT 8
        """)).mappings().all()
        if rows:
            skus = ", ".join([f"{r['name']}({r['sku_cnt']}SKU)" for r in rows])
            ctx_parts.append(f"水果SKU分布: {skus}")
    except Exception:
        pass

    try:
        r = db.execute(text("SELECT COUNT(*) as cnt FROM users WHERE role='worker'")).mappings().first()
        ctx_parts.append(f"工人总数: {r['cnt']}人")
    except Exception:
        pass

    try:
        rows = db.execute(text("""
            SELECT DATE(created_at) as d, COUNT(*) as cnt
            FROM printed_labels
            WHERE created_at >= :wa
            GROUP BY DATE(created_at) ORDER BY d
        """), {"wa": week_ago}).mappings().all()
        if rows:
            trend = ", ".join([f"{str(r['d'])[5:]}:{r['cnt']}" for r in rows])
            ctx_parts.append(f"近7天打印趋势: {trend}")
    except Exception:
        pass

    return "\n".join(ctx_parts) if ctx_parts else "暂无业务数据"


SYSTEM_PROMPT = """你是「果管系统」的AI智能助手，名字叫"果小智"。你是一个水果仓储生产管理系统的专业顾问。

系统核心业务：
- 水果采购入库 → 批次分配给工人 → 工人申请SKU → 管理员打印标签 → 工人包装生产 → 管理员审核 → 出库扫码
- 工人是计件制临时工，佣金 = 出库标签数 × SKU绩效系数
- 标签条码格式：日期(2位)+标签ID，如"06012345"
- 损耗分为标签损耗（打印数vs实际包装数）和重量损耗（采购重量vs出库消耗重量）

你的职责：
1. 回答关于系统使用的问题
2. 分析业务数据趋势
3. 提供管理建议和优化方案
4. 解释业务指标含义
5. 帮助排查异常情况

回复要求：
- 使用简体中文
- 专业但友好
- 只有在“当前实时业务数据”中明确给出数字时，才能引用具体数字
- 如果某项数据不存在、查询结果为0、或上下文没有提供，必须明确说“未查到相关数据”或“今日为0”，绝不能猜测
- 严禁编造水果品类、SKU名称、百分比、均值、损耗率、审核状态、趋势结论
- 用户质疑数据时，先直接纠正，不要圆场，不要继续扩写不存在的数据
- 非必要不要使用emoji，尤其是数据核对场景
- 回答要简洁精准，不要过于冗长"""


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[dict] = Field(default_factory=list)
    stream: bool = Field(default=True)
    context_mode: str = Field(default="auto", description="auto|minimal|full")


class QuickAnalysisRequest(BaseModel):
    analysis_type: str = Field(..., description="today_summary|worker_ranking|loss_analysis|production_trend|inventory_status")


@router.post("/chat")
async def ai_chat(req: ChatRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    biz_context = ""
    if req.context_mode != "minimal":
        biz_context = _build_business_context(db)

    system_msg = SYSTEM_PROMPT
    if biz_context:
        system_msg += f"\n\n当前实时业务数据：\n{biz_context}"
    system_msg += f"\n\n当前用户: {user.real_name or user.username} (角色: {'管理员' if user.role == 'admin' else '工人'})"
    system_msg += f"\n当前日期: {date.today().isoformat()}"

    input_messages = [{"role": "system", "content": system_msg}]
    for h in req.history[-10:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            input_messages.append({"role": h["role"], "content": h["content"][:1500]})
    input_messages.append({"role": "user", "content": req.message})

    if req.stream:
        def generate():
            try:
                responses_client = _get_responses_client()
                stream = responses_client.responses.create(
                    model=QWEN_THINKING_MODEL,
                    input=input_messages,
                    stream=True,
                    extra_body={"enable_thinking": True},
                )
                for event in stream:
                    et = getattr(event, "type", None)
                    if et == "response.reasoning_summary_text.delta":
                        delta = getattr(event, "delta", "")
                        if delta:
                            data = json.dumps({"reasoning": delta}, ensure_ascii=False)
                            yield f"data: {data}\n\n"
                    elif et == "response.output_text.delta":
                        delta = getattr(event, "delta", "")
                        if delta:
                            data = json.dumps({"content": delta}, ensure_ascii=False)
                            yield f"data: {data}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                try:
                    fallback_client = _get_openai_client()
                    resp = fallback_client.chat.completions.create(
                        model=QWEN_MODEL,
                        messages=input_messages,
                        stream=True,
                        temperature=0.2,
                        max_tokens=2000,
                    )
                    for chunk in resp:
                        if chunk.choices and chunk.choices[0].delta.content:
                            data = json.dumps({"content": chunk.choices[0].delta.content}, ensure_ascii=False)
                            yield f"data: {data}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as e2:
                    err = json.dumps({"error": f"AI服务暂时不可用: {str(e2)}"}, ensure_ascii=False)
                    yield f"data: {err}\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    else:
        try:
            client = _get_openai_client()
            resp = client.chat.completions.create(
                model=QWEN_MODEL,
                messages=input_messages,
                temperature=0.2,
                max_tokens=2000,
            )
            content = resp.choices[0].message.content
            return {"success": True, "data": {"content": content, "usage": {
                "prompt_tokens": resp.usage.prompt_tokens,
                "completion_tokens": resp.usage.completion_tokens,
            }}}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"AI服务错误: {str(e)}")


@router.post("/quick-analysis")
async def quick_analysis(req: QuickAnalysisRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """预设快速分析"""
    prompts = {
        "today_summary": "请根据当前业务数据，给我一份今日运营简报，包括生产、出库、待处理事项的总结。",
        "worker_ranking": "分析近7天工人的出库排行数据，找出表现最好和需要关注的工人，给出管理建议。",
        "loss_analysis": "分析当前的损耗情况，包括标签损耗和重量损耗，找出异常点并给出改善建议。",
        "production_trend": "分析近7天的生产趋势数据，包括打印量走势、出库节奏，预测下周的生产安排建议。",
        "inventory_status": "分析当前库存状况，在库标签数、待出库情况，给出库存周转和管理建议。",
    }
    prompt = prompts.get(req.analysis_type)
    if not prompt:
        raise HTTPException(status_code=400, detail=f"不支持的分析类型: {req.analysis_type}")

    client = _get_openai_client()
    biz_context = _build_business_context(db)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT + f"\n\n当前实时业务数据：\n{biz_context}\n当前日期: {date.today().isoformat()}"},
        {"role": "user", "content": prompt},
    ]

    def generate():
        try:
            resp = client.chat.completions.create(
                model=QWEN_MODEL, messages=messages, stream=True, temperature=0.2, max_tokens=2000,
            )
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    data = json.dumps({"content": chunk.choices[0].delta.content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            err = json.dumps({"error": f"AI服务暂时不可用: {str(e)}"}, ensure_ascii=False)
            yield f"data: {err}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


REPORT_SYSTEM_PROMPT = """你是一个数据库查询助手。用户会用自然语言描述想要查询的数据，你需要生成对应的 MySQL 查询语句。

数据库表结构（关键表）:
- users (id, username, real_name, phone, role: admin/worker, alipay_account, created_at)
- fruits (id, name)
- sku (id, sku_name, sku_description, fruit_id, production_performance, carton_box_id, material_weight, estimated_weight)
- fruit_purchases (id, fruit_id, fruit_name, supplier_name, purchase_date, purchase_weight, purchase_price, payment_status, deleted_at) -- 注意: 总金额=purchase_price*purchase_weight
- printed_labels (id, u=worker_id, b=batch_id/purchase_id, s=sku_id, scanned_outbound: 0/1/2, estimated_weight, actual_weight, weight_difference, scanned_time, created_at)
- sku_transactions (id, fruit_purchase_id, sku_id, worker_id, quantity, is_printed, created_at)
- worker_production (id, worker_id, sku_id, production_date, printed_quantity, actual_packaging_quantity, audit_status: pending/approved/rejected)
- batch_assignments (id, purchase_id, worker_id, assignment_date)
- carton_boxes (id, box_type, purchase_price, stock_quantity, low_stock_threshold)
- upload_records (id, tickets_num, weight, is_success, message, upload_time, machine_number)
- failure_logs (id, tickets_num, worker_id, sku_id, failure_reason, scanned_weight, created_at)
- suppliers (id, name, type: fruit/box/material, contact_person, phone)

重要业务规则:
- scanned_outbound > 0 表示已出库
- 佣金 = COUNT(scanned_outbound > 0 的标签) × production_performance
- fruit_purchases 用 deleted_at IS NULL 排除软删除
- printed_labels.u 是 worker_id，.b 是 purchase_id，.s 是 sku_id

你必须严格按以下JSON格式回复，不要有任何其他内容：
{"sql": "SELECT ...", "description": "查询说明", "chart_type": "table|bar|line|pie"}

安全规则（必须遵守）:
- 只允许 SELECT 查询
- 禁止 INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE
- 禁止子查询修改数据
- 结果限制最多100条 (LIMIT 100)
- 不要查询 users.password 字段"""


class ReportRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=500)


REPORT_TEMPLATES = [
    {"id": "daily_production", "name": "今日生产汇总", "query": "今天每个工人的生产记录数和审核通过数", "icon": "📋"},
    {"id": "weekly_outbound", "name": "本周出库统计", "query": "最近7天每天的出库标签数量", "icon": "📦"},
    {"id": "sku_ranking", "name": "SKU产量排行", "query": "所有SKU的总打印量和出库量排行", "icon": "🏆"},
    {"id": "worker_efficiency", "name": "工人效率分析", "query": "每个工人的打印标签数、出库数和出库率", "icon": "👷"},
    {"id": "fruit_cost", "name": "水果成本分析", "query": "每种水果的总采购重量、总金额和平均单价", "icon": "🍎"},
    {"id": "loss_overview", "name": "损耗概览", "query": "每种SKU的平均重量差异和超差标签数", "icon": "📉"},
    {"id": "supplier_summary", "name": "供应商采购汇总", "query": "每个供应商的总采购次数、总重量和总金额", "icon": "🏪"},
    {"id": "pending_tasks", "name": "待处理事项", "query": "待审核的生产记录数量，按工人分组", "icon": "⏳"},
]


@router.post("/generate-report")
async def generate_report(req: ReportRequest, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """AI 自然语言生成报表"""
    client = _get_openai_client()

    try:
        resp = client.chat.completions.create(
            model=QWEN_MODEL,
            messages=[
                {"role": "system", "content": REPORT_SYSTEM_PROMPT},
                {"role": "user", "content": req.query},
            ],
            temperature=0.1,
            max_tokens=800,
        )
        ai_response = resp.choices[0].message.content.strip()

        if ai_response.startswith("```"):
            ai_response = ai_response.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        import re
        json_match = re.search(r'\{.*\}', ai_response, re.DOTALL)
        if not json_match:
            raise ValueError("AI未返回有效JSON")
        parsed = json.loads(json_match.group())

        sql = parsed.get("sql", "")
        description = parsed.get("description", "")
        chart_type = parsed.get("chart_type", "table")

        forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "CREATE", "GRANT", "REVOKE"]
        sql_upper = sql.upper().strip()
        if not sql_upper.startswith("SELECT"):
            raise ValueError("仅允许SELECT查询")
        for word in forbidden:
            if word in sql_upper:
                raise ValueError(f"禁止使用{word}语句")

        if "LIMIT" not in sql_upper:
            sql = sql.rstrip(";") + " LIMIT 100"

        result = db.execute(text(sql))
        columns = list(result.keys())
        rows = [dict(zip(columns, row)) for row in result.fetchall()]

        for row in rows:
            for k, v in row.items():
                if hasattr(v, 'isoformat'):
                    row[k] = v.isoformat()
                elif isinstance(v, (bytes, bytearray)):
                    row[k] = str(v)
                else:
                    try:
                        row[k] = float(v) if isinstance(v, __import__('decimal').Decimal) else v
                    except (TypeError, ValueError):
                        row[k] = str(v) if v is not None else None

        return {"success": True, "data": {
            "sql": sql,
            "description": description,
            "chart_type": chart_type,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
        }}

    except Exception as e:
        error_msg = str(e)
        if "1064" in error_msg or "syntax" in error_msg.lower():
            error_msg = "生成的SQL语法有误，请尝试换一种描述方式"
        elif "1146" in error_msg:
            error_msg = "查询涉及的表不存在"
        elif "仅允许" in error_msg or "禁止" in error_msg:
            pass
        else:
            error_msg = f"查询执行失败: {error_msg}"
        return {"success": False, "message": error_msg}


@router.get("/report-templates")
async def get_report_templates(user: User = Depends(require_admin)):
    return {"success": True, "data": REPORT_TEMPLATES}


@router.get("/performance-insight")
async def performance_insight(
    worker_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI 生成工人绩效洞察报告"""
    target_id = worker_id if (user.role == "admin" and worker_id) else user.id

    worker = db.query(User).filter(User.id == target_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="工人不存在")

    today = date.today()
    month_start = today.replace(day=1)
    week_ago = today - timedelta(days=7)

    ctx_parts = []
    ctx_parts.append(f"工人: {worker.real_name or worker.username} (ID:{worker.id})")

    try:
        r = db.execute(text("""
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN scanned_outbound>0 THEN 1 ELSE 0 END) as outbound
            FROM printed_labels WHERE u=:wid
        """), {"wid": target_id}).mappings().first()
        ctx_parts.append(f"历史总标签: {r['total']}, 总出库: {r['outbound']}")
    except Exception:
        pass

    try:
        r = db.execute(text("""
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN scanned_outbound>0 THEN 1 ELSE 0 END) as outbound
            FROM printed_labels WHERE u=:wid AND created_at >= :ms
        """), {"wid": target_id, "ms": month_start}).mappings().first()
        ctx_parts.append(f"本月标签: {r['total']}, 本月出库: {r['outbound']}")
    except Exception:
        pass

    try:
        rows = db.execute(text("""
            SELECT DATE(created_at) as d, COUNT(*) as cnt,
                   SUM(CASE WHEN scanned_outbound>0 THEN 1 ELSE 0 END) as ob
            FROM printed_labels WHERE u=:wid AND created_at >= :wa
            GROUP BY DATE(created_at) ORDER BY d
        """), {"wid": target_id, "wa": week_ago}).mappings().all()
        if rows:
            trend = ", ".join([f"{str(r['d'])[5:]}:打{r['cnt']}出{r['ob']}" for r in rows])
            ctx_parts.append(f"近7天日趋势: {trend}")
    except Exception:
        pass

    try:
        rows = db.execute(text("""
            SELECT s.sku_name, COUNT(pl.id) as cnt,
                   SUM(CASE WHEN pl.scanned_outbound>0 THEN 1 ELSE 0 END) as ob,
                   s.production_performance as perf
            FROM printed_labels pl JOIN sku s ON pl.s=s.id
            WHERE pl.u=:wid AND pl.created_at >= :ms
            GROUP BY pl.s ORDER BY cnt DESC LIMIT 8
        """), {"wid": target_id, "ms": month_start}).mappings().all()
        if rows:
            sku_info = ", ".join([f"{r['sku_name']}(打{r['cnt']}出{r['ob']}绩效{float(r['perf']):.2f})" for r in rows])
            ctx_parts.append(f"本月SKU明细: {sku_info}")
    except Exception:
        pass

    try:
        r = db.execute(text("""
            SELECT SUM(CASE WHEN audit_status='pending' THEN 1 ELSE 0 END) as pending,
                   SUM(CASE WHEN audit_status='approved' THEN actual_packaging_quantity ELSE 0 END) as approved_qty,
                   SUM(CASE WHEN audit_status='rejected' THEN 1 ELSE 0 END) as rejected
            FROM worker_production WHERE worker_id=:wid AND production_date >= :ms
        """), {"wid": target_id, "ms": month_start}).mappings().first()
        ctx_parts.append(f"本月生产: 审核通过量{_as_int(r['approved_qty'])}, 待审{_as_int(r['pending'])}, 驳回{_as_int(r['rejected'])}")
    except Exception:
        pass

    try:
        r = db.execute(text("""
            SELECT COALESCE(SUM(s.production_performance), 0) as commission
            FROM printed_labels pl JOIN sku s ON pl.s=s.id
            WHERE pl.u=:wid AND pl.scanned_outbound>0 AND pl.created_at >= :ms
        """), {"wid": target_id, "ms": month_start}).mappings().first()
        ctx_parts.append(f"本月预估佣金: {float(r['commission']):.2f}")
    except Exception:
        pass

    try:
        r = db.execute(text("""
            SELECT AVG(cnt) as avg_labels FROM (
                SELECT COUNT(*) as cnt FROM printed_labels
                WHERE created_at >= :ms GROUP BY u
            ) t
        """), {"ms": month_start}).mappings().first()
        ctx_parts.append(f"全员本月平均标签数: {float(r['avg_labels'] or 0):.0f}")
    except Exception:
        pass

    worker_data = "\n".join(ctx_parts)

    prompt = f"""请根据以下工人数据，生成一份简洁的绩效分析报告。

{worker_data}

请包含以下内容（用 markdown 格式）:
1. **绩效概况**: 用1-2句话总结该工人的整体表现
2. **数据亮点**: 列出2-3个值得关注的数据点
3. **对比分析**: 与团队平均水平的对比
4. **改善建议**: 给出2-3条具体可操作的建议
5. **佣金预测**: 按当前趋势预测本月总佣金

保持回复简洁精炼，总共不超过300字。"""

    client = _get_openai_client()

    def generate():
        try:
            resp = client.chat.completions.create(
                model=QWEN_MODEL,
                messages=[
                    {"role": "system", "content": "你是果管系统的绩效分析顾问，擅长分析工人生产数据并给出建议。回复使用简体中文。"},
                    {"role": "user", "content": prompt},
                ],
                stream=True, temperature=0.2, max_tokens=1500,
            )
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    data = json.dumps({"content": chunk.choices[0].delta.content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            err = json.dumps({"error": str(e)}, ensure_ascii=False)
            yield f"data: {err}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/audit-advice")
async def audit_advice(
    req: ChatRequest,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """AI 审核建议 — 分析生产记录合理性"""
    client = _get_openai_client()

    biz_context = _build_business_context(db)

    messages = [
        {"role": "system", "content": f"""你是一个生产审核顾问。管理员正在审核工人的生产记录。
请根据提供的信息，分析该记录是否合理，给出审核建议。

分析维度:
1. 实际包装数量是否合理（对比打印数量）
2. 工人的历史表现是否一致
3. SKU的正常产量范围
4. 是否有异常模式

回复格式:
- 📊 数据分析（简要）
- ✅/⚠️/❌ 审核建议（通过/需要注意/建议驳回）
- 💡 备注

保持简洁，不超过100字。

当前业务数据:
{biz_context}"""},
        {"role": "user", "content": req.message},
    ]

    def generate():
        try:
            resp = client.chat.completions.create(
                model=QWEN_MODEL, messages=messages, stream=True, temperature=0.3, max_tokens=500,
            )
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    data = json.dumps({"content": chunk.choices[0].delta.content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            err = json.dumps({"error": str(e)}, ensure_ascii=False)
            yield f"data: {err}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/auto-inspect")
async def auto_inspect(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """AI 自动巡检 — 扫描业务异常并生成通知"""
    from app.utils.notify import notify_user
    from app.models import CartonBox

    today = date.today()
    alerts_generated = 0

    try:
        low_stock = db.execute(text("""
            SELECT id, box_type, stock_quantity, low_stock_threshold
            FROM carton_boxes
            WHERE stock_quantity <= low_stock_threshold AND low_stock_threshold > 0
        """)).mappings().all()

        admin_ids = [u.id for u in db.query(User.id).filter(User.role == "admin").all()]

        for item in low_stock:
            existing = db.execute(text("""
                SELECT COUNT(*) as cnt FROM user_messages
                WHERE user_id=:uid AND msg_type='alert' AND title LIKE :t
                AND DATE(created_at) = :d
            """), {"uid": admin_ids[0] if admin_ids else 0, "t": f"%{item['box_type']}%", "d": today}).mappings().first()
            if existing and existing['cnt'] == 0:
                for uid in admin_ids:
                    notify_user(db, uid,
                        title=f"库存预警：{item['box_type']}",
                        content=f"当前库存{item['stock_quantity']}，低于阈值{item['low_stock_threshold']}",
                        msg_type="alert", link="/inventory/alerts")
                    alerts_generated += 1
    except Exception:
        pass

    try:
        weight_anomalies = db.execute(text("""
            SELECT pl.id, pl.weight_difference, u.real_name, ws.max_weight_difference
            FROM printed_labels pl
            JOIN users u ON pl.u = u.id
            CROSS JOIN weight_settings ws
            WHERE ABS(pl.weight_difference) > ws.max_weight_difference
            AND pl.scanned_outbound > 0
            AND DATE(pl.scanned_time) = :d
            LIMIT 10
        """), {"d": today}).mappings().all()

        for wa in weight_anomalies:
            for uid in admin_ids:
                notify_user(db, uid,
                    title=f"重量异常：标签#{wa['id']}",
                    content=f"工人{wa['real_name']}标签差异{float(wa['weight_difference']):.1f}g，超出阈值{float(wa['max_weight_difference']):.1f}g",
                    msg_type="alert", link="/reports/weight")
                alerts_generated += 1
    except Exception:
        pass

    try:
        pending = db.execute(text("""
            SELECT COUNT(*) as cnt FROM worker_production WHERE audit_status='pending'
        """)).mappings().first()
        if pending and pending['cnt'] > 20:
            for uid in admin_ids:
                existing = db.execute(text("""
                    SELECT COUNT(*) as cnt FROM user_messages
                    WHERE user_id=:uid AND msg_type='reminder' AND title LIKE '%待审核积压%'
                    AND DATE(created_at) = :d
                """), {"uid": uid, "d": today}).mappings().first()
                if existing and existing['cnt'] == 0:
                    notify_user(db, uid,
                        title=f"待审核积压提醒",
                        content=f"当前有{pending['cnt']}条生产记录待审核，请及时处理。",
                        msg_type="reminder", link="/production/audit")
                    alerts_generated += 1
    except Exception:
        pass

    db.commit()
    return {"success": True, "data": {"alerts_generated": alerts_generated}}


@router.get("/suggestions")
async def get_suggestions(user: User = Depends(get_current_user)):
    """返回根据用户角色定制的问题建议"""
    if user.role == "admin":
        return {"success": True, "data": [
            {"icon": "📊", "title": "今日运营简报", "desc": "生产出库全局总结", "type": "today_summary"},
            {"icon": "👷", "title": "工人绩效分析", "desc": "排行与管理建议", "type": "worker_ranking"},
            {"icon": "📉", "title": "损耗分析", "desc": "标签和重量损耗", "type": "loss_analysis"},
            {"icon": "📈", "title": "生产趋势", "desc": "近7天走势预测", "type": "production_trend"},
            {"icon": "📦", "title": "库存状况", "desc": "周转与管理建议", "type": "inventory_status"},
            {"icon": "💡", "title": "自由提问", "desc": "问我任何问题", "type": "free"},
        ]}
    else:
        return {"success": True, "data": [
            {"icon": "📋", "title": "我的今日工作", "desc": "查看今日任务总结", "type": "free", "prompt": "帮我总结一下今天的工作情况"},
            {"icon": "💰", "title": "佣金估算", "desc": "估算本月佣金", "type": "free", "prompt": "帮我估算一下这个月的佣金"},
            {"icon": "🏆", "title": "绩效提升", "desc": "如何提升排名", "type": "free", "prompt": "分析一下我的绩效，给出提升建议"},
            {"icon": "❓", "title": "使用帮助", "desc": "系统功能说明", "type": "free", "prompt": "这个系统都有哪些功能，教我怎么用"},
        ]}
