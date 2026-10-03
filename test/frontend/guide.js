// The guide's voice (ElevenLabs by default) and ears, shared by onboarding and home.
// Load this file BEFORE the page's own script:
//   <script src="/assets/guide.js"></script>
//   <script src="/assets/onboarding.js"></script>
//
// The page must have these parts (by id): question, label, heard, choices,
// mic, hint, typed, typed-input, switch.

// ---------- Finding things on the page ----------
const $ = (id) => document.getElementById(id);

// Send only wording context to the backend. Raw saved answers stay unchanged.
function guideContext(profile, stepIndex = 0) {
  return {
    state: String(profile.state || "").slice(0, 200),
    moment: profile.moment === "I'm there" ? "" : String(profile.moment || "").slice(0, 6000),
    steps: (profile.steps || []).slice(0, 8).map(step => ({ kind: step.kind, text: String(step.text || "").slice(0, 6000) })),
    step_index: stepIndex,
  };
}

const guideRequests = new Set();
let guideGeneration = 0;

async function phraseGuide(goal, profile, fallback, stepIndex = 0) {
  const controller = new AbortController();
  guideRequests.add(controller);
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("/api/guide/phrase", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ goal, context: guideContext(profile, stepIndex) }),
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    return typeof data.text === "string" && data.text.trim() && data.text.length <= 420 ? data.text : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    guideRequests.delete(controller);
  }
}

function cancelGuidePhrasing() {
  guideGeneration++;
  for (const request of guideRequests) request.abort();
  if (waiting) {
    const resolve = waiting;
    waiting = null;
    resolve(null);
  }
}

// ---------- Speaking (the guide's voice) ----------
// Default: ElevenLabs via POST /api/tts. Set window.PEAK_TTS = "browser" before this script for system speech.
if (window.PEAK_TTS === undefined) window.PEAK_TTS = "elevenlabs";
const useElevenLabs = () => window.PEAK_TTS !== "browser";

let voice = null;
let currentAudio = null;

// Pick a soft English voice if the computer has one.
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const favorites = ["Samantha", "Ava", "Serena", "Karen", "Moira", "Google UK English Female"];
  voice = favorites.map((name) => voices.find((v) => v.name.includes(name))).find(Boolean) || voices[0] || null;
}
pickVoice();
speechSynthesis.onvoiceschanged = pickVoice;

function speakBrowser(text, rate = 0.85) {
  return new Promise((done) => {
    speechSynthesis.cancel();
    const line = new SpeechSynthesisUtterance(text);
    if (voice) line.voice = voice;
    line.rate = rate; // 0.85 = a little slower than normal
    line.pitch = 0.95; // a little lower than normal
    line.onend = done;
    line.onerror = done;
    // Backup: some browsers never say "finished", so don't wait forever.
    setTimeout(done, 2000 + text.length * 120);
    speechSynthesis.speak(line);
  });
}

function ttsErrorHint(message) {
  const hint = $("hint");
  if (hint) hint.textContent = message;
  console.error(message);
}

async function speakElevenLabs(text) {
  stopSpeaking();
  let res;
  try {
    res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    ttsErrorHint(
      "Could not reach the guide voice server. Run: cd test/backend && uvicorn main:app --reload",
    );
    throw err;
  }
  if (!res.ok) {
    let detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      detail = parsed.detail || detail;
    } catch {
      /* plain text */
    }
    ttsErrorHint(`ElevenLabs voice failed: ${detail}`);
    throw new Error(detail);
  }
  const blob = await res.blob();
  if (!blob.size) {
    ttsErrorHint("ElevenLabs returned empty audio.");
    throw new Error("empty audio");
  }
  const url = URL.createObjectURL(blob);
  return new Promise((done) => {
    const audio = new Audio(url);
    currentAudio = audio;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      done();
    };
    audio.onended = finish;
    audio.onerror = () => {
      ttsErrorHint("Could not play ElevenLabs audio in this browser.");
      finish();
    };
    setTimeout(finish, 60000 + text.length * 120);
    audio.play().catch(() => {
      ttsErrorHint("Tap Begin again if the guide voice did not start.");
      finish();
    });
  });
}

// Say the text slowly and calmly. Finishes when the voice stops talking.
function speak(text, rate = 0.85) {
  if (useElevenLabs()) return speakElevenLabs(text);
  return speakBrowser(text, rate);
}

function stopSpeaking() {
  speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------- Listening (the person's voice) ----------
const Recognizer = window.SpeechRecognition || window.webkitSpeechRecognition;
let canListen = Boolean(Recognizer);
let typing = !canListen; // type instead of speak
let recognizer = null;
let silenceTimer = null;
let waiting = null; // the question that is waiting for an answer

function startListening() {
  if (!canListen || typing) return;
  stopListening();
  let finalWords = "";
  recognizer = new Recognizer();
  recognizer.lang = "en-US";
  recognizer.continuous = true;
  recognizer.interimResults = true;

  // Show the words while the person talks. A 2-second pause sends the answer.
  recognizer.onresult = (event) => {
    let partWords = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalWords += event.results[i][0].transcript + " ";
      else partWords += event.results[i][0].transcript;
    }
    const heard = (finalWords + partWords).trim();
    $("heard").textContent = heard;
    $("heard").classList.add("partial");
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => heard && submit(heard), 2000);
  };

  // If the browser blocks the microphone, switch to typing.
  recognizer.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      canListen = false;
      setTyping(true);
    }
  };

  recognizer.start();
  $("mic").classList.add("listening");
  $("hint").textContent = "Listening… pause when you're done";
}

function stopListening() {
  clearTimeout(silenceTimer);
  if (recognizer) {
    recognizer.onresult = null;
    recognizer.abort();
    recognizer = null;
  }
  $("mic").classList.remove("listening");
}

// Show the mic, or the typing box.
function setTyping(on) {
  typing = on;
  $("mic").hidden = on;
  $("typed").hidden = !on;
  $("switch").hidden = !canListen;
  $("switch").textContent = on ? "Answer by voice instead" : "Type instead";
  if (on) {
    stopListening();
    $("hint").textContent = canListen ? "" : "Voice answers need Chrome or Safari.";
    $("typed-input").focus();
  } else if (waiting) {
    startListening();
  }
}

// Hide the mic, typing box and switch (when no answer is needed).
function hideAnswerTools() {
  stopListening();
  $("mic").hidden = true;
  $("typed").hidden = true;
  $("switch").hidden = true;
  $("hint").textContent = "";
}

// ---------- Asking ----------
const RATING_CHOICES = ["0", "2", "4", "6", "8", "10"];

// Show one question, say it out loud, then wait for the answer.
async function ask(label, question, choices = []) {
  const generation = guideGeneration;
  showChoices([]);
  hideAnswerTools();
  show(label, question);
  $("hint").textContent = "";
  await speak(question);
  if (generation !== guideGeneration) return null;
  showChoices(choices);
  const answer = new Promise((resolve) => (waiting = resolve));
  setTyping(typing); // show the mic (and start listening) or the typing box
  return answer;
}

// Ask a question that has tap answers. A spoken answer is matched to the closest tap answer.
async function askChoice(label, question, choices) {
  const reply = await ask(label, question, choices);
  if (reply === null) return null;
  return matchChoice(reply, choices);
}

// Ask for a number from 0 to 10. Asks once more if no number is heard.
async function askRating(label, question) {
  for (let tries = 0; tries < 2; tries++) {
    const reply = await ask(label, question, RATING_CHOICES);
    if (reply === null) return null;
    const n = toNumber(reply);
    if (n !== null) return n;
    question = "Just a number from 0 to 10, please.";
  }
  return null;
}

// The guide says something that is not a question.
async function say(label, text, pause = 800) {
  show(label, text);
  showChoices([]);
  await speak(text);
  await wait(pause);
}

// Called by the mic, an answer button, or the typing box.
function submit(text) {
  text = text.trim();
  if (!text || !waiting) return;
  const resolve = waiting;
  waiting = null;
  stopListening();
  showChoices([]);
  $("heard").textContent = text;
  $("heard").classList.remove("partial");
  $("typed-input").value = "";
  $("hint").textContent = "";
  resolve(text);
}

function show(label, text) {
  $("label").textContent = label;
  const q = $("question");
  q.textContent = text;
  q.classList.remove("fade");
  void q.offsetWidth; // restart the fade-in animation
  q.classList.add("fade");
  $("heard").textContent = "";
}

function showChoices(choices) {
  $("choices").replaceChildren(
    ...choices.map((text) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.onclick = () => submit(text);
      return b;
    }),
  );
}

// ---------- Understanding words ----------

// "it was pretty bright" → "Bright". If nothing matches, keep the person's own words.
function matchChoice(reply, choices) {
  const t = reply.toLowerCase();
  return choices.find((c) => t.includes(c.toLowerCase())) || reply;
}

// "about a seven" → 7
function toNumber(reply) {
  const digits = reply.match(/\b(10|[0-9])\b/);
  if (digits) return Number(digits[1]);
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const i = words.findIndex((w) => new RegExp(`\\b${w}\\b`, "i").test(reply));
  return i >= 0 ? i : null;
}

// Turn "I saw the crowd" into "you saw the crowd", for reading it back.
function toYou(text) {
  return text
    .replace(/\bI'm\b/gi, "you're")
    .replace(/\bI was\b/gi, "you were")
    .replace(/\bmyself\b/gi, "yourself")
    .replace(/\bmy\b/gi, "your")
    .replace(/\bme\b/gi, "you")
    .replace(/\bI\b/g, "you")
    .replace(/[.!]+$/, "");
}

// ---------- The AI guide (on our server) ----------
const SAFETY_MESSAGE =
  "Let's pause here. I'm not the right support for this. Please reach out to someone you trust, or your local emergency services.";

// Ask the server's AI guide. Returns its answer, or null if the AI is not available
// (no key, an error, or no answer within 25 seconds). Then the page uses its built-in script.
async function askGuideAI(path, body) {
  $("hint").textContent = "Your guide is thinking…";
  try {
    const reply = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    return reply.ok ? await reply.json() : null;
  } catch {
    return null;
  } finally {
    $("hint").textContent = "";
  }
}

// ---------- Saved states ----------
// Every state the person has mapped, saved on this computer:
//   { "calm": { state, moment, steps, drivers, ... }, "motivated": { ... } }
const STATES_KEY = "peakstate.states";

function loadStates() {
  try {
    return JSON.parse(localStorage.getItem(STATES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState(answers) {
  const all = loadStates();
  all[answers.state] = answers;
  localStorage.setItem(STATES_KEY, JSON.stringify(all));
}

// ---------- Buttons for answering ----------
$("mic").onclick = () => (recognizer ? submit($("heard").textContent) : startListening());
$("switch").onclick = () => setTyping(!typing);
$("typed").onsubmit = (event) => {
  event.preventDefault();
  submit($("typed-input").value);
};
