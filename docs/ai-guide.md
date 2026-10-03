# Natural wording for the demo guide

The test app uses OpenAI to fit prior answers naturally into follow-up questions and recalled cues. For example, after “I heard the water and stopped thinking about work,” the next question can be “After hearing the water, what happened next inside you?” The original answer remains unchanged in the saved profile.

The four-question onboarding order remains scripted. The model phrases the remembered moment, first trigger, next step and sequence readback. In the full flow it also phrases the sequence confirmation and step introductions. Dashboard sessions use it for recalling the saved moment and steps and asking the check-in. Choices, ratings, saved answers, round limits and stop controls remain owned by the application.

## Run locally

From the repository root in PowerShell:

```powershell
python -m venv tmp/guide-venv
./tmp/guide-venv/Scripts/python.exe -m pip install -r test/backend/requirements.txt
$env:OPENAI_API_KEY = '<your API key>'
$env:OPENAI_MODEL = 'gpt-4o-mini' # optional; this is the default
./tmp/guide-venv/Scripts/python.exe -m uvicorn main:app --app-dir test/backend --port 8766
```

Open http://127.0.0.1:8766/onboarding. Keep credentials in the server environment; the browser never receives them. With no key, a timeout, a refusal or invalid output, the guide uses short scripted wording without pasting an entire answer into the sentence.

## Implementation and boundaries

`POST /api/guide/phrase` accepts an approved conversational goal and bounded context (state, moment, steps, selected step index). It uses the [OpenAI Responses API with Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) to request a single `text` field. Instructions require short, grounded paraphrases, preserve question intent and treat answers as untrusted data. The server validates completion, shape, length and question count; invalid output falls back. Grounding and semantic quality remain prompt-based and need real-user evaluation.

Only the selected profile's wording context is sent to OpenAI; heart rate, HRV, passwords and unrelated saved profiles are excluded. Requests set `store: false`; that setting is not a claim of zero retention under provider policies. The browser aborts slow requests after ten seconds and cancels pending wording requests when a dashboard session ends. Raw profiles and answers continue to live in browser local storage.

The separate synthetic Oura workflow remains deterministic. This change adds an LLM to the test app's conversational wording, not to biometric detection or recovery decisions.

Tests (includes HTTP validation; `httpx` is a test dependency):

```powershell
./tmp/guide-venv/Scripts/python.exe -m pip install httpx
./tmp/guide-venv/Scripts/python.exe -m unittest discover -s test/backend -p 'test_*.py' -v
node --test test/frontend/test-guide.cjs
```

No live model request was made during implementation because no OpenAI API key was configured. Mocked provider responses verify the integration and fallback paths; wording quality still needs a live check with credentials.
