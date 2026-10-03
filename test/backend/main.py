from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="Test App")

app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")


@app.get("/")
async def home() -> FileResponse:
    return FileResponse(FRONTEND / "index.html")


@app.get("/onboarding")
async def onboarding() -> FileResponse:
    return FileResponse(FRONTEND / "onboarding.html")


@app.get("/action")
async def action() -> FileResponse:
    return FileResponse(FRONTEND / "action.html")
