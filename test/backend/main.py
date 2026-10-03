import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
USERS_FILE = Path(__file__).resolve().parent / "users.json"

app = FastAPI(title="Test App")

app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")


class AuthBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


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

