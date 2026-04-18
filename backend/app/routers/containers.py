from fastapi import APIRouter

router = APIRouter(prefix="/containers", tags=["containers"])


@router.get("/health")
def containers_health():
    return {"status": "ok", "service": "container-api"}
