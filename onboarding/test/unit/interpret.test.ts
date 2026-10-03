import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildInterpretRequest,
  createInterpreter,
  echoOverlap,
  isFillerOnly,
  looksUnfinished,
  parseInterpretResponse,
  readInterpretBody,
} from "../../src/voice/interpret.ts";

const ctx = { question: "What state do you want to choose?", choices: ["Content", "Destressed"], expects: "choice" as const };

test("interpret helpers: fillers, trailing off, echo share", () => {
  assert.equal(isFillerOnly("um, uh... hmm"), true);
  assert.equal(isFillerOnly(""), true);
  assert.equal(isFillerOnly("um content"), false);
  assert.equal(looksUnfinished("I was on the beach and"), true);
  assert.equal(looksUnfinished("the light on the water,"), true);
  assert.equal(looksUnfinished("the light on the water."), false);
  assert.equal(echoOverlap("look at that picture again", "Look at that picture again. Where is it?"), 1);
  assert.equal(echoOverlap("off to my left", "Look at that picture again. Where is it?"), 0);
});

test("buildInterpretRequest: Responses API with a strict schema, no storage, the question and choices as context", () => {
  const req = buildInterpretRequest("gpt-5.4-mini", ctx, "uh con tent") as any;
  assert.equal(req.model, "gpt-5.4-mini");
  assert.equal(req.store, false);
  assert.deepEqual(req.reasoning, { effort: "none" });
  assert.equal(req.text.format.type, "json_schema");
  assert.equal(req.text.format.strict, true);
  assert.deepEqual(req.text.format.schema.properties.verdict.enum, ["answer", "incomplete", "noise"]);
  assert.deepEqual(JSON.parse(req.input), { question: ctx.question, choices: ctx.choices, expects: "choice", heard: "uh con tent" });
  assert.match(req.instructions, /best guess/);
  assert.match(req.instructions, /not therapy/);
});

test("parseInterpretResponse: reads the output_text JSON; rejects unusable replies", () => {
  const reply = (text: string) => ({ output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text }] }] });
  assert.deepEqual(parseInterpretResponse(reply('{"verdict":"answer","text":" Content "}')), { verdict: "answer", text: "Content" });
  assert.deepEqual(parseInterpretResponse(reply('{"verdict":"incomplete","text":"x"}')), { verdict: "incomplete", text: "" });
  assert.deepEqual(parseInterpretResponse(reply('{"verdict":"answer","text":""}')), { verdict: "noise", text: "" });
  assert.equal(parseInterpretResponse(reply("not json")), null);
  assert.equal(parseInterpretResponse({}), null);
});

test("readInterpretBody: validates the page's request", () => {
  assert.deepEqual(readInterpretBody({ question: "Q?", choices: ["A", 3], expects: "number", heard: "seven" }), {
    ctx: { question: "Q?", choices: ["A"], expects: "number" },
    heard: "seven",
  });
  assert.equal(readInterpretBody({ heard: "  " }), null);
  assert.equal(readInterpretBody({ heard: "x".repeat(2001) }), null);
  assert.equal(readInterpretBody({ heard: "hi", expects: "weird" })!.ctx.expects, "open");
});

test("createInterpreter: posts to the route with headers; falls back to the raw words on any failure", async () => {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  let reply: { ok: boolean; status: number; body: string } = { ok: true, status: 200, body: '{"verdict":"answer","text":"Content"}' };
  const fetch = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: reply.ok, status: reply.status, text: async () => reply.body };
  };
  const interpret = createInterpreter({ fetch, headers: () => ({ authorization: "Bearer t" }) });
  assert.deepEqual(await interpret(ctx, "uh con tent"), { verdict: "answer", text: "Content" });
  assert.equal(calls[0]!.url, "/api/answer/interpret");
  assert.equal(calls[0]!.headers.authorization, "Bearer t");
  assert.deepEqual(calls[0]!.body, { question: ctx.question, choices: ctx.choices, expects: "choice", heard: "uh con tent" });

  reply = { ok: true, status: 200, body: '{"verdict":"incomplete","text":""}' };
  assert.deepEqual(await interpret(ctx, "I was"), { verdict: "incomplete", text: "" });
  reply = { ok: false, status: 502, body: "{}" };
  assert.deepEqual(await interpret(ctx, " content "), { verdict: "answer", text: "content" }, "server trouble: raw words");
  assert.deepEqual(await interpret(ctx, "um"), { verdict: "noise", text: "" }, "server trouble and only fillers: noise");
  const broken = createInterpreter({ fetch: async () => { throw new Error("offline"); } });
  assert.deepEqual(await broken(ctx, "content"), { verdict: "answer", text: "content" });
});
