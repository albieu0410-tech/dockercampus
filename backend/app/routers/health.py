from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import time

from app.database import get_db

router = APIRouter(prefix="/health", tags=["health"])

START_TIME = time.time()


@router.get("")
async def health(db: AsyncSession = Depends(get_db)):
    db_status = "ok"
    db_latency = None

    try:
        t = time.time()
        await db.execute(text("SELECT 1"))
        db_latency = round((time.time() - t) * 1000, 2)
    except Exception as e:
        db_status = f"error: {str(e)}"

    uptime = round(time.time() - START_TIME)

    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "uptime_seconds": uptime,
        "services": {
            "api": {"status": "ok"},
            "database": {
                "status": db_status,
                "latency_ms": db_latency,
            },
        },
    }
