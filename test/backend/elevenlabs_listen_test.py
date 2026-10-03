"""
Hear onboarding-style lines with ElevenLabs.

1. Paste your API key in ELEVENLABS_API_KEY below, or put it in test/backend/.env
2. Run from test/backend:

     python3 elevenlabs_listen_test.py
     python3 elevenlabs_listen_test.py --list-voices

Free API accounts cannot use Voice Library IDs (e.g. Rachel). Use --list-voices
and set VOICE_ID to one of your voices, or leave VOICE_ID empty to auto-pick
the first voice that works (often a default premade or a Voice Design voice).
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from elevenlabs_tts import (
    FALLBACK_VOICES,
    MODEL_ID,
    load_dotenv,
    list_voices,
    pick_working_voice,
    resolve_api_key,
    synthesize,
)

# Paste key here, or use ELEVENLABS_API_KEY= in test/backend/.env (this file wins if set).
ELEVENLABS_API_KEY = "sk_05e7773b2037422fc506c55ca390e8abc6bd7b738b984f81"

# Leave empty to auto-pick; library voices (Rachel, etc.) fail on free API with 402.
VOICE_ID = ""

PHRASES = [
    "Hi. I'm your guide. I'll ask a few questions, one at a time. Just answer out loud.",
    "Which state would you like to be able to return to?",
    "Can you remember a specific time when you were totally calm? Go back to that time and step into it.",
    "Good. Stay there for a moment. See what you saw. Hear what you heard.",
    "What was the very first thing that caused you to be totally calm? Something you saw, something you heard, or the touch of something?",
    "What did you see?",
    "That's your path to calm. When you drift, I'll walk you back through it, in this order.",
]


def _clean_key(value: str) -> str:
    return value.strip().strip('"').strip("'")


def bootstrap_api_key() -> None:
    key = _clean_key(ELEVENLABS_API_KEY)
    if key:
        os.environ["ELEVENLABS_API_KEY"] = key
    load_dotenv()


def voice_label(voice_id: str) -> str:
    for vid, name in FALLBACK_VOICES:
        if vid == voice_id:
            return name
    if VOICE_ID.strip() == voice_id:
        return "configured VOICE_ID"
    for v in list_voices():
        if v.get("voice_id") == voice_id:
            name = v.get("name") or voice_id
            category = v.get("category") or "?"
            return f"{name} ({category})"
    return voice_id


def play_mp3(data: bytes) -> None:
    tmp = Path("/tmp/peak_elevenlabs_test.mp3")
    tmp.write_bytes(data)
    if sys.platform == "darwin":
        subprocess.run(["afplay", str(tmp)], check=False)
        return
    print(f"Wrote {tmp} — open it to listen.")


def cmd_list_voices() -> None:
    voices = list_voices()
    if not voices:
        print(
            "Could not list voices (often: API key lacks voices_read permission).\n"
            "Default voice IDs you can set in VOICE_ID:"
        )
        for vid, name in FALLBACK_VOICES:
            print(f"  {name:<12} {vid}")
        return
    print(f"{'name':<24} {'category':<12} voice_id")
    print("-" * 72)
    for v in voices:
        print(f"{(v.get('name') or ''):<24} {(v.get('category') or ''):<12} {v.get('voice_id')}")


def main() -> None:
    bootstrap_api_key()
    if not resolve_api_key():
        sys.exit(
            "No API key. Set ELEVENLABS_API_KEY in this file or in test/backend/.env"
        )

    parser = argparse.ArgumentParser(description="Play onboarding lines with ElevenLabs")
    parser.add_argument("--list-voices", action="store_true", help="Show voices on your account")
    args = parser.parse_args()

    if args.list_voices:
        cmd_list_voices()
        return

    if VOICE_ID.strip():
        os.environ["ELEVENLABS_VOICE_ID"] = VOICE_ID.strip()

    print("Finding a voice that works on your API plan…")
    voice_id = pick_working_voice()
    print(f"Using: {voice_label(voice_id)}\n  id={voice_id}\n  model={MODEL_ID}")
    print(f"Playing {len(PHRASES)} line(s)…\n")

    for i, line in enumerate(PHRASES, start=1):
        preview = line if len(line) <= 72 else line[:72] + "…"
        print(f"[{i}/{len(PHRASES)}] {preview}")
        play_mp3(synthesize(line, voice_id))

    print("\nDone.")


if __name__ == "__main__":
    main()
