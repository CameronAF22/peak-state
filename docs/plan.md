# Plan: Oura trigger and three strategies

Peak State should notice a downshift in the body and offer a short voice session whose job is to surface, then use, the person's three peak-state strategies.

The loop is closed only after the person accepts. Oura data can raise an offer. It does not start a voice session, and it does not call anyone.

```
Oura sync → webhook or slow poll → classify → offer
                                              │
                         person accepts ──────┘
                                              ▼
                         GPT Live 1 voice session
                                              │
                         extract or run the 3 strategies
```

## What this pass settles

| Step | Result | Where |
|---|---|---|
| Oura constraints and which signals exist | Researched | [oura-constraints.md](oura-constraints.md) |
| State-change frame for the voice | Robbins triad, turned into prompt rules | [state-change.md](state-change.md) |
| Questions that extract the three strategies | Written as the voice prompt | [../prompts/strategy-extraction.md](../prompts/strategy-extraction.md) |
| Data the voice and the trigger share | Schema | [../schemas/](../schemas/) |
| How a negative-state signal becomes a session | Flow | [trigger-flow.md](trigger-flow.md) |

## Product rule

One intervention type. When the person accepts an offer:

- If the three strategies are not confirmed, GPT Live 1 runs strategy extraction and stops when three confirmed strategies are stored.
- If they are confirmed, GPT Live 1 runs them in order: body, then attention, then words. It does not invent a fourth technique.

Sensory anchors (song, scene, body cue) stay in the profile as optional detail inside those strategies. They are not a separate product path.

## Build order

1. Keep strategy extraction working with no Oura account. The three strategies are the deliverable.
2. Connect Oura read-only and record snapshots. Do not notify.
3. Turn on offers only after a personal baseline rule is written. No universal heart-rate cutoff ships.
4. On accept, open GPT Live 1 with the session context in [../schemas/voice-session.schema.json](../schemas/voice-session.schema.json).

## Still open

See [open-questions.md](open-questions.md). The latency question is answered. Thresholds and the exact quiet-hours policy are proposals, not measurements.
