import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Literal
from starlette.concurrency import run_in_threadpool

from guide_ai import phrase

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
USERS_FILE = Path(__file__).resolve().parent / "users.json"

app = FastAPI(title="Test App")

app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")


class AuthBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class GuideStep(BaseModel):
    kind: Literal["saw", "heard", "said", "felt"]
    text: str = Field(max_length=6000)


class GuideContext(BaseModel):
    state: str = Field(default="", max_length=200)
    moment: str = Field(default="", max_length=6000)
    steps: list[GuideStep] = Field(default_factory=list, max_length=8)
    step_index: int = Field(default=0, ge=0, le=7)


class GuideBody(BaseModel):
    goal: Literal["moment", "first_trigger", "next_step", "sequence", "sequence_confirm",
                  "step_intro", "recall_moment", "recall_step", "check_in"]
    context: GuideContext


@app.post("/api/guide/phrase")
async def guide_phrase(body: GuideBody) -> dict[str, str]:
    return await run_in_threadpool(phrase, body.goal, body.context.model_dump())


def load_users() -> dict[str, str]:
    if not USERS_FILE.exists():
        return {}
    data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {}
    return {str(k): str(v) for k, v in data.items()}


def save_users(users: dict[str, str]) -> None:
    USERS_FILE.write_text(
        json.dumps(users, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


@app.get("/")
async def home() -> FileResponse:
    # The first page is the dashboard.
    return FileResponse(FRONTEND / "home.html")


@app.get("/onboarding")
async def onboarding() -> FileResponse:
    return FileResponse(FRONTEND / "onboarding.html")


@app.get("/home")
async def home_page() -> FileResponse:
    return FileResponse(FRONTEND / "home.html")


@app.post("/api/auth/register")
async def register(body: AuthBody) -> dict[str, str]:
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username required")
    users = load_users()
    if username in users:
        raise HTTPException(status_code=409, detail="Username already taken")
    users[username] = body.password
    save_users(users)
    return {"username": username}


@app.post("/api/auth/login")
async def login(body: AuthBody) -> dict[str, str]:
    username = body.username.strip()
    users = load_users()
    if users.get(username) != body.password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return {"username": username}


@app.get("/api/auth/me")
async def me(username: str) -> dict[str, str]:
    name = username.strip()
    users = load_users()
    if name not in users:
        raise HTTPException(status_code=404, detail="User not found")
    return {"username": name}
