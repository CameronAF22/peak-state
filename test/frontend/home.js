// Home page: choose a state (or say "I'm stressed"), then a calm voice guides
// the person back into that state, using their own answers from onboarding.
// After each round the guide checks in ("Are you calm now?"). The session ends
// when they say yes, or after MAX_ROUNDS rounds, so it never goes on forever.
//
// Uses guide.js (load it first) for speaking, listening and asking.
// OpenAI phrases recalled cues on the backend; session order and limits remain scripted.

// ---------- 1. Settings ----------
const MAX_ROUNDS = 3; // at most this many rounds, then the session ends
const STEP_PAUSE = 5000; // silence after each step, in milliseconds (5 seconds)
const DETAIL_PAUSE = 2500; // silence after each detail
const CHECK_IN_CHOICES = ["Yes", "A little", "Not yet"];
const STEP_WORD = { saw: "See", heard: "Hear", said: "Say", felt: "Feel" };
const SESSIONS_KEY = "peakstate.sessions";

// ---------- 2. Writing the guidance ----------
// Each saved detail (from onboarding) becomes one calm sentence.
// The keys and answers here must match DETAILS in onboarding.js.
const DETAIL_WORDS = {
  motion: { Movie: "Let it move, like a movie.", Still: "Let it be still, like a photo." },
  color: { Color: "See it in full color.", "Black and white": "See it in black and white." },
  brightness: { Bright: "Make it bright.", Medium: "Let the light be soft and clear.", Dim: "Keep the light low and gentle." },
  size: { "Big and close": "Let it be big, and close to you.", Medium: "Let it be just the right size.", "Small and far": "Let it sit small, and far away." },
  location: { "In front": "Put it right in front of you.", Left: "Let it sit to your left.", Right: "Let it sit to your right.", Up: "Let it float a little above you.", Down: "Let it rest a little below you." },
  view: { "My own eyes": "See it through your own eyes.", "Watching myself": "Watch yourself in it." },
  volume: { Loud: "Let it be loud and full.", Medium: "Let it be at a comfortable volume.", Soft: "Let it be soft." },
  pitch: { High: "Let it be high.", Medium: "Let it sit in the middle.", Low: "Let it be low and deep." },
  tempo: { Fast: "Let it move quickly.", Medium: "Let it keep a steady pace.", Slow: "Let it be slow." },
  tone: { Calm: "Hear the calm in it.", Firm: "Hear how firm it is.", Excited: "Hear the excitement in it.", Warm: "Hear the warmth in it." },
  source: { "In front": "It comes from in front of you.", Behind: "It comes from behind you.", "Inside my head": "Hear it inside your head.", "All around": "Let it surround you." },
  voice: { "My own": "It's your own voice.", "Someone else's": "Hear the voice of the person who says it.", "No voice": "" },
  body: { Chest: "Feel it in your chest.", Stomach: "Feel it in your stomach.", Shoulders: "Feel it in your shoulders.", Head: "Feel it in your head.", "Whole body": "Let it fill your whole body." },
  temperature: { Warm: "Notice the warmth.", Neutral: "Let it be just as it is.", Cool: "Notice the coolness." },
  weight: { Heavy: "Let it feel heavy and grounded.", Medium: "Let it have a gentle weight.", Light: "Let it feel light." },
  movement: { Still: "Let it be still.", Moving: "Let it move.", Spreading: "Let it spread, slowly." },
  intensity: { Strong: "Let it grow strong.", Medium: "Let it grow, gently.", Weak: "Notice it, even if it's small." },
  rhythm: { Steady: "Let it be steady.", Pulsing: "Feel it pulse." },
};

// One saved detail → one sentence. Unknown answers (the person's own words) are skipped.
function detailSentence(key, value) {
  return DETAIL_WORDS[key]?.[value] || "";
}

// Recall each saved step with natural wording.
async function stepSentence(step, profile, index) {
  return phraseGuide("recall_step", profile,
    `Return to step ${index + 1} of your saved sequence, in whatever way feels comfortable.`, index);
}

// The details of one step to use: the drivers first (they matter most), then up to 2 others.
function detailsFor(step, s, round) {
  const driverKeys = (s.drivers || []).map((d) => d.key);
  const all = Object.entries(step.details || {});
  const drivers = all.filter(([key]) => driverKeys.includes(key));
  const others = all.filter(([key]) => !driverKeys.includes(key));
  // Round 1 uses more detail. Later rounds keep only the drivers, to go deeper.
  const chosen = round === 1 ? [...drivers, ...others.slice(0, 2)] : drivers.length ? drivers : others.slice(0, 2);
  return chosen.map(([key, value]) => detailSentence(key, value)).filter(Boolean);
}

// All the lines for one round. Each line is { text, pause }.
async function buildRound(s, round, stressed, stillRunning = () => true) {
  const lines = [];
  if (round === 1) {
    lines.push({ text: stressed ? "I hear you're feeling stressed. That's okay. Let's slow down together." : `Let's take you back to feeling ${s.state}.`, pause: 1500 });
    lines.push({ text: "Find a comfortable position. Let your shoulders drop. Breathe in slowly… and breathe out, even slower.", pause: 4000 });
    const moment = await phraseGuide("recall_moment", s,
      "Recall the moment you saved earlier. Take your time and notice what you remember.");
    if (!stillRunning()) return [];
    lines.push({ text: moment, pause: STEP_PAUSE });
  } else {
    lines.push({ text: "Let's go through it once more, a little slower. Breathe out.", pause: 3000 });
  }
  for (const [index, step] of s.steps.entries()) {
    if (!stillRunning()) return [];
    const sentence = await stepSentence(step, s, index);
    if (!stillRunning()) return [];
    lines.push({ text: sentence, pause: STEP_PAUSE });
    for (const sentence of detailsFor(step, s, round)) lines.push({ text: sentence, pause: DETAIL_PAUSE });
  }
  lines.push({ text: "Stay here with it. Breathe.", pause: 5000 });
  return lines;
}

// ---------- 3. The session ----------
let sessionId = 0; // goes up when a session starts or ends, so an old session stops

function showView(name) {
  $("home-view").hidden = name !== "home";
  $("session-view").hidden = name !== "session";
}

async function runSession(stateName, stressed) {
  const s = loadStates()[stateName];
  if (!s) return;
  const run = ++sessionId;
  const stillRunning = () => run === sessionId;

  showView("session");
  hideAnswerTools();
  $("back-home").hidden = true;
  $("end-session").hidden = false;

  let result = "ended";
  let round = 1;
  for (; round <= MAX_ROUNDS; round++) {
    // Guide through the person's own steps.
    show(`Round ${round} of ${MAX_ROUNDS}`, "Preparing your guide…");
    const lines = await buildRound(s, round, stressed, stillRunning);
    if (!stillRunning()) return;
    for (const line of lines) {
      if (!stillRunning()) return;
      await say(`Round ${round} of ${MAX_ROUNDS}`, line.text, line.pause);
    }
    if (!stillRunning()) return;

    // Check in: are they back in the state?
    const checkIn = await phraseGuide("check_in", s, "Do you feel back in the state you chose now?");
    if (!stillRunning()) return;
    const reply = await askChoice("Check-in", checkIn, CHECK_IN_CHOICES);
    if (!stillRunning()) return;
    hideAnswerTools();

    if (reply === "Yes") {
      result = "yes";
      await say("Well done", `Well done. You found your way back to ${s.state}.`, 0);
      break;
    }
    if (round === MAX_ROUNDS) {
      result = reply === "A little" ? "a little" : "not yet";
      await say("Rest", "That's enough for now. Be gentle with yourself. You can come back any time.", 0);
      break;
    }
    const next = reply === "A little" ? "Good. Let's go a little deeper." : "That's okay. Let's try once more, slowly.";
    await say("Check-in", next, 1000);
  }

  if (!stillRunning()) return;
  saveSession({ state: s.state, stressed, rounds: Math.min(round, MAX_ROUNDS), result, at: new Date().toISOString() });
  $("end-session").hidden = true;
  $("back-home").hidden = false;
}

// "I'm feeling stressed": ask which state to return to (or skip the question if there is only one).
async function runStressed() {
  const names = Object.keys(loadStates());
  if (names.length === 0) {
    window.location.href = "/onboarding";
    return;
  }
  if (names.length === 1) return runSession(names[0], true);

  const run = ++sessionId;
  showView("session");
  $("back-home").hidden = true;
  $("end-session").hidden = false;
  const reply = await askChoice("Let's slow down", "I'm here with you. Which state would you like to return to?", names.map(capitalize));
  if (run !== sessionId) return;
  hideAnswerTools();
  const chosen = names.find((n) => n === reply.toLowerCase()) || names[0];
  runSession(chosen, true);
}

// Stop everything and go back to the home view.
function endSession() {
  sessionId++;
  cancelGuidePhrasing();
  waiting = null;
  stopSpeaking();
  hideAnswerTools();
  showView("home");
  renderStates();
}

// ---------- 4. The home view ----------
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function saveSession(entry) {
  try {
    const all = JSON.parse(localStorage.getItem(SESSIONS_KEY)) || [];
    all.push(entry);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
  } catch {
    // If saving fails, the session still worked. Nothing else to do.
  }
}

function lastSession(state) {
  try {
    const all = JSON.parse(localStorage.getItem(SESSIONS_KEY)) || [];
    return all.filter((e) => e.state === state).pop() || null;
  } catch {
    return null;
  }
}

// One card per saved state: its name, its moment, its steps, and a "Take me back" button.
function renderStates() {
  const states = Object.values(loadStates());
  $("no-states").hidden = states.length > 0;

  $("state-list").replaceChildren(
    ...states.map((s) => {
      const card = document.createElement("article");
      card.className = "state-card";

      const title = document.createElement("h3");
      title.textContent = capitalize(s.state);
      card.append(title);

      if (s.moment && s.moment !== "I'm there") {
        const moment = document.createElement("p");
        moment.className = "moment";
        moment.textContent = s.moment;
        card.append(moment);
      }

      const path = document.createElement("div");
      path.className = "path";
      s.steps.forEach((step, i) => {
        if (i > 0) {
          const arrow = document.createElement("span");
          arrow.className = "arrow";
          arrow.textContent = "→";
          path.append(arrow);
        }
        const pill = document.createElement("span");
        pill.className = "pill";
        const word = document.createElement("b");
        word.textContent = STEP_WORD[step.kind];
        pill.append(word, " " + step.text);
        path.append(pill);
      });
      card.append(path);

      const last = lastSession(s.state);
      if (last) {
        const note = document.createElement("p");
        note.className = "last";
        const when = new Date(last.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        note.textContent = `Last session ${when}: ${last.result === "yes" ? "found it" : last.result} after ${last.rounds} ${last.rounds === 1 ? "round" : "rounds"}`;
        card.append(note);
      }

      const go = document.createElement("button");
      go.type = "button";
      go.className = "start";
      go.textContent = "Take me back";
      go.onclick = () => runSession(s.state, false);
      card.append(go);
      return card;
    }),
  );
}

// ---------- 5. Buttons ----------
$("stressed").onclick = runStressed;
$("end-session").onclick = endSession;
$("back-home").onclick = endSession;

renderStates();
