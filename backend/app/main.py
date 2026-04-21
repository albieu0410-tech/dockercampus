from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from app.limiter import limiter
from app.database import engine, Base
from app.routers import auth, users, containers, github, deployments
from app.routers.health import router as health_router
from app.routers.classes import router as classes_router
from app.routers.resources import router as resources_router
import os
import asyncio
import logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    required = [
        "DATABASE_URL",
        "SECRET_KEY",
        "RESEND_API_KEY",
        "CONTAINER_ENGINE_URL",
    ]
    missing = [v for v in required if not os.getenv(v)]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}"
        )

    logger.info("All required environment variables present")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database tables created/verified")

    yield


app = FastAPI(
    title="DockCampus API",
    description="Gateway between the frontend and the Rust container engine",
    version="0.1.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

origins_raw = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000"
)
origins = [o.strip() for o in origins_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(containers.router)
app.include_router(github.router)
app.include_router(deployments.router)
app.include_router(health_router)
app.include_router(classes_router)
app.include_router(resources_router)
