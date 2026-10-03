const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const element = () => ({hidden: false, value: '', textContent: '', focus() {},
  classList: { add() {}, remove() {}, toggle() {} }, replaceChildren() {}});

function shared(fetch = async () => { throw Error('offline'); }) {
  const elements = new Map();
  const sandbox = {fetch, AbortController, setTimeout, clearTimeout, window: {},
    document: {getElementById: id => {if (!elements.has(id)) elements.set(id, element()); return elements.get(id);}},
    speechSynthesis: {getVoices: () => [], cancel() {}},
    localStorage: {getItem: () => null, setItem() {}},
  };
  vm.createContext(sandbox);
  vm.runInContext(source('guide.js'), sandbox);
  return {sandbox, elements};
}

test('OpenAI wording request sends only selected wording context and preserves answers', async () => {
  let sent;
  const {sandbox} = shared(async (url, options) => {
    assert.equal(url, '/api/guide/phrase'); sent = JSON.parse(options.body);
    return {ok: true, json: async () => ({text: 'After hearing the water, what happened next inside you?'})};
  });
  sandbox.profile = {state:'calm', moment:'I sat by the lake.', steps:[{kind:'heard',text:'I heard the water.',details:{volume:'Soft'}}],
    hr_bpm:80, password:'excluded', unrelatedProfiles:['excluded']};
  const original = JSON.stringify(sandbox.profile);
  const result = await vm.runInContext('phraseGuide("next_step", profile, "What happened next?")',sandbox);
  assert.equal(result,'After hearing the water, what happened next inside you?');
  assert.deepEqual(Object.keys(sent.context), ['state','moment','steps','step_index']);
  assert.deepEqual(sent.context.steps,[{kind:'heard',text:'I heard the water.'}]);
  assert.equal(JSON.stringify(sandbox.profile),original);
});

test('offline and malformed responses return a concise local fallback', async () => {
  for (const fetch of [async()=>{throw Error('offline');}, async()=>({ok:false}),
    async()=>({ok:true,json:async()=>({text:42})})]) {
    const {sandbox} = shared(fetch);
    assert.equal(await vm.runInContext('phraseGuide("next_step", {}, "What happened next?")',sandbox),'What happened next?');
  }
});

test('ending while speech is pending cannot restart answer tools', async () => {
  const {sandbox} = shared();
  let finishSpeech;
  let toolsShown = 0;
  sandbox.testSpeak = () => new Promise(resolve => {finishSpeech=resolve;});
  sandbox.testTools = choices => {if (!Array.isArray(choices) || choices.length) toolsShown++;};
  vm.runInContext('speak = testSpeak; show = () => {}; showChoices = testTools; setTyping = testTools;',sandbox);
  const pending = vm.runInContext('askChoice("Check-in", "Are you back in that state?", ["Yes","A little","Not yet"])',sandbox);
  vm.runInContext('cancelGuidePhrasing()',sandbox);
  finishSpeech();
  assert.equal(await pending,null);
  assert.equal(toolsShown,0);
  assert.equal(vm.runInContext('waiting',sandbox),null);
});

test('ending an active question resolves it without an answer', async () => {
  const {sandbox} = shared();
  vm.runInContext('speak = async () => {}; show = () => {}; showChoices = () => {}; setTyping = () => {};',sandbox);
  const pending = vm.runInContext('ask("Check-in", "Are you back in that state?")',sandbox);
  await Promise.resolve();
  vm.runInContext('cancelGuidePhrasing()',sandbox);
  assert.equal(await pending,null);
});

test('onboarding passes prior answers to natural follow-up phrasing and saves originals', async () => {
  const raw = ['I sat by the lake after a busy day.','I heard the water and stopped thinking about work.','I felt my shoulders relax.'];
  const asked=[],phrased=[];
  const sandbox={$:()=>({}),document:{}, matchChoice:()=>undefined,
    phraseGuide:async(goal,profile,fallback)=>{phrased.push({goal,context:JSON.parse(JSON.stringify(profile))}); return goal==='next_step'?'After hearing the water, what happened next inside you?':fallback;},
    ask:async(label,text)=>{asked.push(text);return raw[asked.length-1];},say:async()=>{},};
  vm.createContext(sandbox); vm.runInContext(source('onboarding.js'),sandbox);
  vm.runInContext('setProgress = () => {}; showPath = () => {}; answers.state = "calm";',sandbox);
  await vm.runInContext('partStrategy()',sandbox);
  assert.equal(asked.length,3);
  assert.equal(asked[2],'After hearing the water, what happened next inside you?');
  assert.equal(phrased[2].context.steps[0].text,raw[1]);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(answers.steps.map(s=>s.text))',sandbox)),raw.slice(1));
  assert.equal(vm.runInContext('answers.moment',sandbox),raw[0]);
});

test('stopped round preparation makes no more wording requests', async () => {
  let running=true,requests=0;
  const sandbox={phraseGuide:async()=>{requests++;running=false;return 'Recall the lake.';},
    profile:{state:'calm',steps:[{kind:'heard',text:'water',details:{}}]},stillRunning:()=>running};
  vm.createContext(sandbox);
  vm.runInContext(source('home.js').split('// ---------- 3. The session ----------')[0],sandbox);
  const lines=await vm.runInContext('buildRound(profile,1,false,stillRunning)',sandbox);
  assert.equal(lines.length,0);assert.equal(requests,1);
});
