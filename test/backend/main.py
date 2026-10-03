import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from elevenlabs_tts import load_dotenv, sync_key_from_listen_test, text_to_speech

load_dotenv()
sync_key_from_listen_test()

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
USERS_FILE = Path(__file__).resolve().parent / "users.json"

app = FastAPI(title="Test App")

app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")


class AuthBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class TtsBody(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


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


@app.post("/api/tts")
async def tts(body: TtsBody) -> Response:
    try:
        audio = text_to_speech(body.text.strip())
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return Response(content=audio, media_type="audio/mpeg")


@app.get("/api/auth/me")
async def me(username: str) -> dict[str, str]:
    name = username.strip()
    users = load_users()
    if name not in users:
        raise HTTPException(status_code=404, detail="User not found")
    return {"username": name}


# ---------- The AI guide (Groq) ----------
# The page calls these. If the AI is not set up, they answer 503
# and the page uses its built-in script instead.


class ReflectBody(BaseModel):
    person: dict  # the state, moment and steps so far
    last_question: str = ""
    last_answer: str = ""
    final: bool = False


class GuideBody(BaseModel):
    person: dict  # the saved state: moment, steps, details, drivers
    round: int = Field(ge=1, le=10)
    max_rounds: int = Field(ge=1, le=10)
    stressed: bool = False
    last_checkin: str | None = None


@app.post("/api/ai/reflect")
async def ai_reflect(body: ReflectBody) -> dict:
    try:
        return await write_reflection(body.person, body.last_question, body.last_answer, body.final)
    except AIUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/api/ai/guide")
async def ai_guide(body: GuideBody) -> dict:
    try:
        return await write_round(body.person, body.round, body.max_rounds, body.stressed, body.last_checkin)
    except AIUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

