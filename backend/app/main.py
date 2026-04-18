from fastapi import FastAPI

from .database import Base, engine
from .routers import auth, containers, users

Base.metadata.create_all(bind=engine)

app = FastAPI(title="DockCampus Backend", version="0.1.0")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(containers.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "backend"}
