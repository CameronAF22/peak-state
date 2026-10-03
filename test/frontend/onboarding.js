// Onboarding: the guide asks a fixed set of questions, one at a time, out loud.
// The person answers by voice, by tapping an answer, or by typing.
//
// The method (from neuro-linguistic programming):
//   1. Strategy: the steps the person goes through to get into the state, in order.
//   2. Details: HOW each step looks, sounds or feels (not what it is about).
//   3. Contrast: the same details for a stuck time. What differs, and which differences matter most (the drivers).
//   4. Use it: give the stuck time the drivers, test it, and rehearse it for the future.
// NLP has little controlled evidence behind it, so the drivers are things to test with the person, not facts.

// ---------- 1. The questions ----------
// Edit the questions here. Everything below uses these lists.

const STATE_CHOICES = ["Motivated", "Calm", "Focused", "Confident"];

// Part 1: the strategy.
const STRATEGY = {
  moment: (state) =>
    `Can you remember a specific time when you were totally ${state}? Go back to that time and step into it.`,
  firstTrigger: (state) =>
    `What was the very first thing that caused you to be totally ${state}? Something you saw, something you heard, or the touch of something?`,
  nextStep:
    "After that, what was the very next thing? Did you make a picture in your mind, say something to yourself, or have a certain feeling?",
};

// Tap answers for the two step questions. Each one tells us the type of step.
const FIRST_CHOICES = { "Something I saw": "saw", "Something I heard": "heard", "A touch or feeling": "felt" };
const NEXT_CHOICES = { "A picture in my mind": "saw", "Something I said to myself": "said", "A feeling": "felt" };

// If the person taps a type, the guide asks what it was.
const WHAT_WAS_IT = {
  saw: "What did you see?",
  heard: "What did you hear?",
  said: "What did you say to yourself?",
  felt: "What was the feeling?",
};

// Part 2: how each type of step is represented.
const DETAILS = {
  picture: [
    { key: "brightness", name: "brightness", ask: "How bright is it?", choices: ["Bright", "Medium", "Dim"] },
    { key: "size", name: "size and distance", ask: "How big is it, and how close?", choices: ["Big and close", "Medium", "Small and far"] },
    { key: "location", name: "location", ask: "Where is the picture? In front of you, to the left, to the right, up, or down?", choices: ["In front", "Left", "Right", "Up", "Down"] },
    { key: "motion", name: "movie or still", ask: "Is the picture moving, like a movie, or still, like a photo?", choices: ["Movie", "Still"] },
    { key: "color", name: "color", ask: "Is it in color, or black and white?", choices: ["Color", "Black and white"] },
    { key: "view", name: "point of view", ask: "Are you seeing it through your own eyes, or watching yourself in it?", choices: ["My own eyes", "Watching myself"] },
  ],
  sound: [
    { key: "volume", name: "volume", ask: "How loud is the sound?", choices: ["Loud", "Medium", "Soft"] },
    { key: "tone", name: "tone", ask: "What is the tone like?", choices: ["Calm", "Firm", "Excited", "Warm"] },
    { key: "source", name: "where it comes from", ask: "Where does it come from?", choices: ["In front", "Behind", "Inside my head", "All around"] },
    { key: "pitch", name: "pitch", ask: "Is it high or low?", choices: ["High", "Medium", "Low"] },
    { key: "tempo", name: "speed", ask: "Is it fast or slow?", choices: ["Fast", "Medium", "Slow"] },
    { key: "voice", name: "whose voice", ask: "Whose voice is it?", choices: ["My own", "Someone else's", "No voice"] },
  ],
  feeling: [
    { key: "body", name: "place in the body", ask: "Where in your body is the feeling?", choices: ["Chest", "Stomach", "Shoulders", "Head", "Whole body"] },
    { key: "temperature", name: "temperature", ask: "Is it warm or cool?", choices: ["Warm", "Neutral", "Cool"] },
    { key: "intensity", name: "strength", ask: "How strong is it?", choices: ["Strong", "Medium", "Weak"] },
    { key: "weight", name: "pressure or weight", ask: "Does it feel heavy or light?", choices: ["Heavy", "Medium", "Light"] },
    { key: "movement", name: "movement", ask: "Is it still, or is it moving or spreading?", choices: ["Still", "Moving", "Spreading"] },
    { key: "rhythm", name: "rhythm", ask: "Is it steady, or pulsing?", choices: ["Steady", "Pulsing"] },
  ],
};

// Which detail list goes with which type of step.
const DETAIL_GROUP = { saw: "picture", heard: "sound", said: "sound", felt: "feeling" };
const GROUP_NAME = { picture: "picture", sound: "sound", feeling: "feeling" };
const STEP_WORD = { saw: "See", heard: "Hear", said: "Say", felt: "Feel" };

// Part 3: contrast.
const CONTRAST = {
  moment: (state) =>
    `Now think of a time you wanted to feel ${state}, but felt stuck instead. Go back there, just for a moment.`,
  baseline: (state) => `Holding that stuck time in mind, how ${state} do you feel right now, from 0 to 10?`,
  oneChange: (d) => `Keep the stuck time in mind. Change just one thing: the ${d.name}. Make it ${d.strong.toLowerCase()} instead of ${d.stuck.toLowerCase()}.`,
  rate: (state) => `How ${state} do you feel now, from 0 to 10?`,
  letGo: "Good. Let it go back to how it was.",
};
// How long onboarding is.
// true  = only 4 questions: the state, the moment, the first trigger, the next step.
// false = the full method: those 4, then details, contrast, and "use it".
const SHORT_VERSION = true;
// For the full method only. Raise these numbers to ask more questions.
const DETAILS_PER_STEP = 3; // ask the first 3 detail questions of each list (the lists are in order of importance)
const MAX_TESTS = 2; // test at most this many differences, one at a time
const MAX_DRIVERS = 3; // keep at most this many drivers

// Part 4: use it.
const USE_IT = {
  recode: (drivers) => `Now take the stuck time, and change all of these at once: ${drivers}. Tell me when you've done it.`,
  test: (state) => `Think of that old situation again. How ${state} do you feel now, from 0 to 10?`,
  rehearse: (state) => `Last one. Think of a time coming up when you'll want to feel ${state}. Picture it with these changes. When is it?`,
};

// ---------- 2. What we save ----------
const answers = {
  state: "",
  moment: "",
  steps: [], // [{ kind, text, details: { key: value } }]
  contrast: { moment: "", details: {} }, // details: { picture: { key: value }, ... }
  differences: [], // [{ group, key, name, strong, stuck, score }]
  baseline: null,
  drivers: [],
  test: null,
  future: "",
};

// ---------- 3. Progress bar and path ----------
// (Speaking, listening and asking are in guide.js, shared with the home page.)

function setProgress(part) {
  [...$("progress").children].forEach((bar, i) => bar.classList.toggle("on", i <= part));
}

// Show the steps so far, like: See the crowd → Feel warm in my chest
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

// ---------- 4. Understanding an answer ----------
// Guess the type of step from the words, when the person talks instead of tapping.
function guessKind(text) {
  const t = text.toLowerCase();
  if (/myself|in my head|inner voice/.test(t)) return "said";
  if (/\b(saw|see|look|picture|image|imagine|watch|light|bright)/.test(t)) return "saw";
  if (/\b(heard|hear|sound|music|song|voice|noise|cheer|crowd)/.test(t)) return "heard";
  return "felt";
}

// Ask about one step. Returns { kind, text }.
async function askStep(label, question, choices) {
  const reply = await ask(label, question, Object.keys(choices));
  const tapped = matchChoice(reply, Object.keys(choices));
  if (choices[tapped]) {
    const kind = choices[tapped];
    const text = await ask(label, WHAT_WAS_IT[kind]);
    return { kind, text, details: {} };
  }
  return { kind: guessKind(reply), text: reply, details: {} };
}

// Ask every detail question for one type of step. Returns { key: answer }.
async function askDetails(label, group) {
  const found = {};
  for (const q of DETAILS[group].slice(0, DETAILS_PER_STEP)) {
    found[q.key] = await askChoice(label, q.ask, q.choices);
  }
  return found;
}

// ---------- 5. The conversation ----------

// Part 1: the strategy, in order.
async function partStrategy() {
  // In the short version, the person answers in their own words (no type buttons),
  // so there is no extra "What was it?" question.
  const first = SHORT_VERSION ? {} : FIRST_CHOICES;
  const next = SHORT_VERSION ? {} : NEXT_CHOICES;

  setProgress(SHORT_VERSION ? 1 : 0);
  answers.moment = await ask("The moment", await phraseGuide("moment", answers, "Recall a specific time you felt the state you chose. Can you tell me about that moment?"), ["I'm there"]);
  await say("The moment", "Good. Stay there for a moment. See what you saw. Hear what you heard.", 2500);

  if (SHORT_VERSION) setProgress(2);
  answers.steps.push(await askStep("The first trigger", await phraseGuide("first_trigger", answers, "In that moment, what first sparked the feeling: something you saw, heard or felt?"), first));
  showPath();

  if (SHORT_VERSION) setProgress(3);
  answers.steps.push(await askStep("The next step", await phraseGuide("next_step", answers, STRATEGY.nextStep), next));
  showPath();

  // Write the sequence down in order. The order matters as much as the parts.
  if (SHORT_VERSION) {
    // Read it back as a statement, not a question, to keep it to 4 questions.
    await say("Your sequence", await phraseGuide("sequence", answers, "You noticed a first trigger, followed by another step. Those are the two steps we’ll return to."), 1500);
    return;
  }
  const order = await askChoice(
    "1 · Your sequence",
    await phraseGuide("sequence_confirm", answers, "Think about your first trigger and the step that followed. Is that the right order?"),
    ["Yes", "Swap them"],
  );
  if (order === "Swap them") {
    answers.steps.reverse();
    showPath();
  }
}

// Part 2: how each step is represented.
async function partDetails() {
  setProgress(1);
  await say("2 · The details", "Now let's look closer at each step. Not what it's about, just how it is.");
  for (const [i, step] of answers.steps.entries()) {
    const group = DETAIL_GROUP[step.kind];
    await say(`2 · Step ${i + 1}`, await phraseGuide("step_intro", answers, `Bring step ${i + 1} to mind. Let’s look at the ${GROUP_NAME[group]}.`, i), 400);
    step.details = await askDetails(`2 · Step ${i + 1} · ${GROUP_NAME[group]}`, group);
  }
}

// Part 3: the same for a stuck time, then find what matters most.
async function partContrast() {
  setProgress(2);
  answers.contrast.moment = await ask("3 · A stuck time", CONTRAST.moment(answers.state), ["I'm there"]);

  // The same detail questions, for the same types of step.
  const groups = [...new Set(answers.steps.map((s) => DETAIL_GROUP[s.kind]))];
  for (const group of groups) {
    await say("3 · A stuck time", `In that stuck time, think about the ${GROUP_NAME[group]}. Same questions as before.`, 400);
    answers.contrast.details[group] = await askDetails(`3 · Stuck · ${GROUP_NAME[group]}`, group);
  }

  // Compare the two lists and mark what differs.
  for (const group of groups) {
    const strongStep = answers.steps.find((s) => DETAIL_GROUP[s.kind] === group);
    for (const q of DETAILS[group].slice(0, DETAILS_PER_STEP)) {
      const strong = strongStep.details[q.key];
      const stuck = answers.contrast.details[group][q.key];
      if (strong && stuck && strong.toLowerCase() !== stuck.toLowerCase()) {
        answers.differences.push({ group, key: q.key, name: q.name, strong, stuck, score: null });
      }
    }
  }
  showDifferences();

  if (answers.differences.length === 0) {
    await say("3 · What's different", "The two times look the same in these details. That's useful to know too.", 1500);
    return;
  }
  await say(
    "3 · What's different",
    `I found ${answers.differences.length} ${answers.differences.length === 1 ? "difference" : "differences"}. Let's see which ones matter most.`,
    1200,
  );

  // Change one difference at a time and notice which shifts the feeling most.
  answers.baseline = await askRating("3 · Before", CONTRAST.baseline(answers.state));
  for (const d of answers.differences.slice(0, MAX_TESTS)) {
    await say("3 · One change", CONTRAST.oneChange(d), 3000);
    d.score = await askRating("3 · One change", CONTRAST.rate(answers.state));
    await say("3 · One change", CONTRAST.letGo, 1200);
    showDifferences();
  }

  // The drivers: the changes that raised the feeling the most.
  answers.drivers = answers.differences
    .filter((d) => d.score !== null && answers.baseline !== null && d.score > answers.baseline)
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_DRIVERS);
  showDifferences();
}

// Part 4: use the drivers on the stuck time, test it, and rehearse it.
async function partUseIt() {
  setProgress(3);
  if (answers.drivers.length) {
    const list = answers.drivers.map((d) => `the ${d.name} ${d.strong.toLowerCase()}`).join(", and ");
    await ask("4 · Recode", USE_IT.recode(list), ["Done"]);
    answers.test = await askRating("4 · Test", USE_IT.test(answers.state));
  }
  answers.future = await ask("4 · Rehearse", USE_IT.rehearse(answers.state));
}

async function runOnboarding() {
  $("start").hidden = true;
  setTyping(typing);

  const howMany = SHORT_VERSION ? "four short questions" : "a set of short questions";
  await say("Welcome", `Hi. I'm your guide. I'll ask ${howMany}, one at a time. Just answer out loud.`);

  setProgress(0);
  const state = await askChoice("Your state", "Which state would you like to be able to return to?", STATE_CHOICES);
  answers.state = state.toLowerCase().replace(/[.!?]$/, "");

  await partStrategy();
  if (!SHORT_VERSION) {
    await partDetails();
    await partContrast();
    await partUseIt();
  }

  // Finish: save this state on this computer (next to any others) and show the summary.
  answers.savedAt = new Date().toISOString();
  saveState(answers);
  hideAnswerTools();
  showSummary();
  $("go-home").hidden = false;
  await say("All set", `That's your path to ${answers.state}. When you drift, I'll walk you back through it, in this order.`, 0);
}

// ---------- 6. Showing results ----------

// The list of differences, with each test score and a star for the drivers.
function showDifferences() {
  const box = $("differences");
  box.hidden = answers.differences.length === 0;
  const rows = answers.differences.map((d) => {
    const li = document.createElement("li");
    if (answers.drivers.includes(d)) li.className = "driver";
    const score = d.score === null ? "" : ` · ${d.score}/10`;
    li.textContent = `${d.name}: ${d.strong} vs ${d.stuck}${score}`;
    return li;
  });
  box.querySelector("ul").replaceChildren(...rows);
}

// Everything we learned, at the end.
function showSummary() {
  $("label").textContent = "All set";
  $("question").textContent = `Your path to ${answers.state}`;
  $("heard").textContent = "";

  const box = $("summary");
  box.hidden = false;
  const add = (tag, text, className) => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    box.append(el);
    return el;
  };

  box.replaceChildren();
  add("h2", "Your sequence");
  const steps = add("ol", "");
  for (const s of answers.steps) {
    const li = document.createElement("li");
    const details = Object.values(s.details).join(", ");
    li.textContent = `${STEP_WORD[s.kind]}: ${s.text}${details ? ` (${details})` : ""}`;
    steps.append(li);
  }

  if (answers.drivers.length) {
    add("h2", "Your drivers");
    const drivers = add("ul", "");
    for (const d of answers.drivers) {
      const li = document.createElement("li");
      li.textContent = `${d.name}: ${d.strong}`;
      drivers.append(li);
    }
  }
  if (answers.baseline !== null && answers.test !== null) {
    add("p", `Stuck time: ${answers.baseline}/10 before, ${answers.test}/10 after the changes.`);
  }
  if (answers.future) add("p", `Next time you'll use it: ${answers.future}`);
  add("p", "Drivers are a starting point to test with you over time, not facts.", "note");
}

// ---------- 7. Buttons ----------
$("start").onclick = runOnboarding;
