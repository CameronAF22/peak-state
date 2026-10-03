// Onboarding: the guide asks one question at a time, out loud,
// and the person answers by voice (or by typing if voice is not available).

// ---------- 1. Finding things on the page ----------
const $ = (id) => document.getElementById(id);

// ---------- 2. The words the guide uses ----------
// Each step type has a short word for the path at the top of the page.
const STEP_WORD = { saw: "See", heard: "Hear", said: "Say", felt: "Feel" };

// Answer buttons for the first trigger (question 2) and the next steps (question 3).
const FIRST_CHOICES = { "Something I saw": "saw", "Something I heard": "heard", "A touch or feeling": "felt" };
const NEXT_CHOICES = { "A picture in my mind": "saw", "Something I said to myself": "said", "A feeling": "felt" };
const DONE_CHOICE = "I was fully in it";

// If the person taps a type of step, the guide asks what it was.
const FOLLOW_UP = {
  saw: "What did you see?",
  heard: "What did you hear?",
  said: "What did you say to yourself?",
  felt: "What was the feeling, and where was it?",
};

// ---------- 3. What we save ----------
const answers = { state: "", moment: "", steps: [] };

// ---------- 4. Speaking (the guide's voice) ----------
let voice = null;

// Pick a soft English voice if the computer has one.
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const favorites = ["Samantha", "Ava", "Serena", "Karen", "Moira", "Google UK English Female"];
  voice = favorites.map((name) => voices.find((v) => v.name.includes(name))).find(Boolean) || voices[0] || null;
}
pickVoice();
speechSynthesis.onvoiceschanged = pickVoice;

// Say the text slowly and calmly. Finishes when the voice stops talking.
function speak(text) {
  return new Promise((done) => {
    speechSynthesis.cancel();
    const line = new SpeechSynthesisUtterance(text);
    if (voice) line.voice = voice;
    line.rate = 0.85; // a little slower than normal
    line.pitch = 0.95; // a little lower than normal
    line.onend = done;
    line.onerror = done;
    // Backup: some browsers never say "finished", so don't wait forever.
    setTimeout(done, 2000 + text.length * 110);
    speechSynthesis.speak(line);
  });
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------- 5. Listening (the person's voice) ----------
const Recognizer = window.SpeechRecognition || window.webkitSpeechRecognition;
let canListen = Boolean(Recognizer);
let typing = !canListen; // type instead of speak
let recognizer = null;
let silenceTimer = null;

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

// ---------- 6. Asking one question ----------
let waiting = null; // the question that is waiting for an answer

// Show one question, say it out loud, then wait for the answer.
async function ask(label, question, choices = []) {
  show(label, question);
  $("hint").textContent = "";
  await speak(question);
  showChoices(choices);
  const answer = new Promise((resolve) => (waiting = resolve));
  if (typing) setTyping(true);
  else startListening();
  return answer;
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

function setProgress(part) {
  [...$("progress").children].forEach((bar, i) => bar.classList.toggle("on", i <= part));
}

// Show the steps so far, like: See the crowd → Say "here we go" → Feel warm
function showPath() {
  $("path").replaceChildren(
    ...answers.steps.flatMap((step, i) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      const word = document.createElement("b");
      word.textContent = STEP_WORD[step.kind];
      pill.append(word, " " + step.text);
      if (i === 0) return [pill];
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = "→";
      return [arrow, pill];
    }),
  );
}

// ---------- 7. Understanding an answer ----------
// Guess the type of step from the words, when the person talks instead of tapping.
function guessKind(text) {
  const t = text.toLowerCase();
  if (/myself|in my head|inner voice/.test(t)) return "said";
  if (/\b(saw|see|look|picture|image|imagine|watch|light|bright)/.test(t)) return "saw";
  if (/\b(heard|hear|sound|music|song|voice|noise|cheer|crowd)/.test(t)) return "heard";
  return "felt";
}

function isDone(text) {
  return text === DONE_CHOICE || /\b(fully|that's it|that's all|done|nothing else)\b/i.test(text);
}

// Ask about one step. Returns { kind, text }, or null when the person is fully in the state.
async function askStep(label, question, choices) {
  const reply = await ask(label, question, [...Object.keys(choices), ...(label === "The first trigger" ? [] : [DONE_CHOICE])]);
  if (isDone(reply)) return null;
  if (choices[reply]) {
    const kind = choices[reply];
    const text = await ask(label, FOLLOW_UP[kind]);
    return { kind, text };
  }
  return { kind: guessKind(reply), text: reply };
}

// ---------- 8. The conversation ----------
async function runOnboarding() {
  $("start").hidden = true;
  setTyping(typing);

  await say("Welcome", "Hi. I'm your guide. I'll ask a few questions, one at a time. Just answer out loud.");

  // Which state?
  setProgress(0);
  const state = await ask("Your state", "Which state would you like to be able to return to?", ["Motivated", "Calm", "Focused", "Confident"]);
  answers.state = state.toLowerCase().replace(/[.!?]$/, "");

  // Question 1: get them fully back in the state.
  setProgress(1);
  answers.moment = await ask(
    "The moment",
    `Can you remember a specific time when you were totally ${answers.state}? Go back to that time and step into it.`,
    ["I'm there"],
  );
  await say("The moment", "Good. Stay there for a moment. See what you saw. Hear what you heard.", 2500);

  // Question 2: find the first trigger.
  setProgress(2);
  const first = await askStep(
    "The first trigger",
    `What was the very first thing that caused you to be totally ${answers.state}? Something you saw, something you heard, or the touch of something?`,
    FIRST_CHOICES,
  );
  if (first) {
    answers.steps.push(first);
    showPath();
  }

  // Question 3: find the next step. Repeat until they are fully in the state.
  let question = "After that, what was the very next thing? Did you make a picture in your mind, say something to yourself, or have a certain feeling?";
  while (answers.steps.length < 6) {
    const step = await askStep("The next step", question, NEXT_CHOICES);
    if (!step) break;
    answers.steps.push(step);
    showPath();
    question = "And the next thing?";
  }

  // Finish: save the answers on this computer.
  setProgress(3);
  localStorage.setItem("peakstate.onboarding", JSON.stringify(answers));
  $("mic").hidden = true;
  $("typed").hidden = true;
  $("switch").hidden = true;
  await say("All set", `That's your path to ${answers.state}. When you drift, I'll walk you back through it, in this order.`);
}

// ---------- 9. Buttons ----------
$("start").onclick = runOnboarding;
$("mic").onclick = () => (recognizer ? submit($("heard").textContent) : startListening());
$("switch").onclick = () => setTyping(!typing);
$("typed").onsubmit = (event) => {
  event.preventDefault();
  submit($("typed-input").value);
};
