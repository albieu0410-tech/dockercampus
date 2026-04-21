import subprocess
import shutil
import os
from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_current_user, require_role
from app.models import User

router = APIRouter(prefix="/resources", tags=["resources"])


def _parse_docker_df() -> dict:
    try:
        result = subprocess.run(
            ["docker", "system", "df"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return {"raw": result.stdout, "error": None}
    except Exception as e:
        return {"raw": "", "error": str(e)}


def _get_disk_usage() -> dict:
    try:
        total, used, free = shutil.disk_usage("/")
        return {
            "total_gb": round(total / 1024 / 1024 / 1024, 2),
            "used_gb": round(used / 1024 / 1024 / 1024, 2),
            "free_gb": round(free / 1024 / 1024 / 1024, 2),
            "percent": round((used / total) * 100, 1),
        }
    except Exception as e:
        return {"error": str(e)}


def _get_log_size() -> str:
    try:
        result = subprocess.run(
            ["du", "-sh", "/var/log"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.stdout:
            return result.stdout.split()[0]
        return "unknown"
    except Exception:
        return "unknown"


@router.get("/storage")
async def get_storage_breakdown(
    current_user: User = Depends(get_current_user),
):
    if current_user.role.value not in ("admin", "professor"):
        raise HTTPException(
            status_code=403,
            detail="Insufficient permissions",
        )

    docker_info = _parse_docker_df()
    disk = _get_disk_usage()
    log_size = _get_log_size()

    return {
        "disk": disk,
        "docker": docker_info,
        "logs_size": log_size,
    }


@router.post("/cleanup")
async def cleanup_resources(
    current_user: User = Depends(require_role("admin")),
):
    results = []

    try:
        r = subprocess.run(
            ["docker", "image", "prune", "-f"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        results.append(f"Images: {r.stdout.strip()}")
    except Exception as e:
        results.append(f"Image prune failed: {e}")

    try:
        r = subprocess.run(
            [
                "docker",
                "builder",
                "prune",
                "-f",
                "--keep-storage",
                "2GB",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        results.append(f"Build cache: {r.stdout.strip()}")
    except Exception as e:
        results.append(f"Builder prune failed: {e}")

    return {
        "message": "Cleanup complete",
        "details": results,
    }
