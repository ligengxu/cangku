import httpx
import logging

logger = logging.getLogger(__name__)

FINANCE_API_BASE = "http://127.0.0.1:92/api"
FINANCE_API_KEY = "fruit-admin-bridge-2026"


async def push_payment_to_finance(
    supplier_name: str,
    amount: float,
    reason: str,
    source_order_id: int,
    source_order_type: str,
) -> dict:
    """Push a pending payment to the finance system"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{FINANCE_API_BASE}/receive_payment.php",
                json={
                    "api_key": FINANCE_API_KEY,
                    "supplier_name": supplier_name,
                    "amount": amount,
                    "reason": reason,
                    "source_system": "fruit-admin",
                    "source_order_id": source_order_id,
                    "source_order_type": source_order_type,
                },
            )
            result = resp.json()
            if result.get("success"):
                logger.info(f"Payment pushed to finance: order {source_order_type}#{source_order_id} ¥{amount}")
            else:
                logger.warning(f"Finance push failed: {result.get('message')}")
            return result
    except Exception as e:
        logger.error(f"Finance bridge error: {e}")
        return {"success": False, "message": str(e)}


async def push_salary_to_finance(
    worker_name: str,
    amount: float,
    settlement_month: str,
    settlement_id: int,
    alipay_account: str | None = None,
) -> dict:
    """Push a worker salary settlement to the finance system"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{FINANCE_API_BASE}/receive_salary.php",
                json={
                    "api_key": FINANCE_API_KEY,
                    "worker_name": worker_name,
                    "amount": amount,
                    "settlement_month": settlement_month,
                    "source_system": "fruit-admin",
                    "source_settlement_id": settlement_id,
                    "alipay_account": alipay_account or "",
                },
            )
            result = resp.json()
            if result.get("success"):
                logger.info(f"Salary pushed to finance: {worker_name} ¥{amount} for {settlement_month}")
            else:
                logger.warning(f"Salary push failed: {result.get('message')}")
            return result
    except Exception as e:
        logger.error(f"Finance bridge salary error: {e}")
        return {"success": False, "message": str(e)}


def push_payment_sync(
    supplier_name: str,
    amount: float,
    reason: str,
    source_order_id: int,
    source_order_type: str,
) -> dict:
    """Synchronous version for use in non-async contexts"""
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                f"{FINANCE_API_BASE}/receive_payment.php",
                json={
                    "api_key": FINANCE_API_KEY,
                    "supplier_name": supplier_name,
                    "amount": amount,
                    "reason": reason,
                    "source_system": "fruit-admin",
                    "source_order_id": source_order_id,
                    "source_order_type": source_order_type,
                },
            )
            result = resp.json()
            if result.get("success"):
                logger.info(f"Payment pushed to finance: {source_order_type}#{source_order_id} ¥{amount} (inbox_id={result.get('inbox_id')})")
            else:
                logger.warning(f"Payment push failed: {source_order_type}#{source_order_id} ¥{amount} - {result.get('message')}")
            return result
    except Exception as e:
        logger.error(f"Finance bridge sync error: {e}")
        return {"success": False, "message": str(e)}


def push_salary_sync(
    worker_name: str,
    amount: float,
    settlement_month: str,
    settlement_id: int,
    alipay_account: str | None = None,
) -> dict:
    """Synchronous version of push_salary_to_finance"""
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(
                f"{FINANCE_API_BASE}/receive_salary.php",
                json={
                    "api_key": FINANCE_API_KEY,
                    "worker_name": worker_name,
                    "amount": amount,
                    "settlement_month": settlement_month,
                    "source_system": "fruit-admin",
                    "source_settlement_id": settlement_id,
                    "alipay_account": alipay_account or "",
                },
            )
            result = resp.json()
            if result.get("success"):
                logger.info(f"Salary pushed to finance: {worker_name} ¥{amount} for {settlement_month}")
            else:
                logger.warning(f"Salary push failed: {result.get('message')}")
            return result
    except Exception as e:
        logger.error(f"Finance bridge salary sync error: {e}")
        return {"success": False, "message": str(e)}
