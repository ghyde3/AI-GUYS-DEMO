# Pipeline Demo — Design Spec

**Date:** 2026-08-06
**Purpose:** 60-minute "vibe check" build for the A.I. Guys AI Build Engineer application. Demo: messy input (files or pasted text) → Claude API → structured summary → delivered to webhook or email. Deliverable is a working deployed app plus a 2-minute Loom walkthrough.

## Goals

- Ship a working, deployed demo in ~60 minutes.
- Config-driven pipeline: the JSON config, not code, defines inputs, LLM steps, and delivery — this is the on-camera answer to "can it also do [X]?"
- Look like production software in the walkthrough: live Vercel URL, guaranteed-valid JSON output, clean UI.

## Non-goals

- No auth, no persistence, no test suite (explicit decision: TDD is skipped for this project for brevity — this deviates from our usual workflow deliberately).
- No enterprise error handling; readable errors only.
- No file storage — files are read client-side and sent as text.

## Stack

- Next.js (App Router, TypeScript), deployed to Vercel.
- Anthropic TypeScript SDK (`@anthropic-ai/sdk`), model `claude-opus-5`, structured outputs via `output_config.format` (JSON schema) so LLM step output is guaranteed valid JSON.
- Resend for email delivery; plain `fetch` POST for webhook delivery.
- Secrets via env vars: `ANTHROPIC_API_KEY`, `RESEND_API_KEY` (local `.env.local` and Vercel project settings).

## Architecture

One page, two API routes, one runner module, one config file.

```
app/page.tsx              — landing page (dropzone, paste-text area, destination input, results panel)
app/api/config/route.ts   — returns pipeline.config.json (frontend is config-driven)
app/api/run/route.ts      — receives input, loads config, runs pipeline, returns step outputs
lib/pipeline.ts           — the runner (~60 lines)
pipeline.config.json      — the centerpiece
```

## The config

```json
{
  "name": "Messy Data Summarizer",
  "model": "claude-opus-5",
  "input": {
    "accept": [".csv", ".txt", ".md", ".json", ".log"],
    "allowText": true,
    "maxTotalKb": 150,
    "mode": "combined"
  },
  "delivery": {
    "defaultTarget": ""
  },
  "steps": [
    {
      "type": "llm",
      "id": "summarize",
      "prompt": "Analyze the input files and produce a structured summary. Identify key points, named entities, data quality issues, and concrete action items.",
      "schema": {
        "title": "string",
        "key_points": "string[]",
        "entities": "string[]",
        "data_quality_issues": "string[]",
        "action_items": "string[]"
      }
    },
    { "type": "deliver", "target": "auto" }
  ]
}
```

- `input.accept` — allowed file extensions. Drives the dropzone filter and hint text in the UI **and** server-side validation in `/api/run`. Config is the single source of truth.
- `input.allowText` — when true, the UI renders a paste-text textarea alongside the dropzone. Pasted text becomes an input named `pasted-text.txt` in the same `files` array; the runner doesn't distinguish input sources.
- `input.maxTotalKb` — combined payload cap, enforced client-side (friendly warning) and server-side (400).
- `input.mode` — `"combined"` (default): all inputs go through the llm steps together, producing one summary. `"per_file"`: the runner loops the llm steps once per input, producing one structured summary per file (deliver steps send the whole collection). Answers the predictable client ask "I have 10 files — I want 10 summaries."
- `steps` — ordered array, two step types:
  - `llm`: `{ prompt, schema, id }`. Calls Claude with the step prompt + accumulated input, using structured outputs built from `schema` (shorthand types `string` / `string[]` expanded to a proper JSON schema with `additionalProperties: false` and all fields required). Output becomes input to the next step. Steps are chainable (extract → summarize → …).
  - `deliver`: `{ target }`. `"auto"` = use the destination the user typed (contains `@` → Resend email; starts with `http` → webhook POST of the JSON payload), falling back to `delivery.defaultTarget`. No destination anywhere → step is skipped with status "skipped (no destination)".

## Request/response contract

`POST /api/run` body:

```ts
{ files: { name: string; content: string }[], destination?: string }
```

Response:

```ts
{
  steps: {
    id: string;            // "summarize" or "deliver"
    type: "llm" | "deliver";
    status: "ok" | "error" | "skipped";
    output?: unknown;      // llm: the structured JSON (an array of {file, summary} in per_file mode); deliver: { target, method }
    error?: string;
  }[]
}
```

Delivery failure does not lose the summary — earlier step outputs still return and render, with a "delivery failed" badge on the deliver step.

## UI

Single page, clean and modern (this is a vibe check — visual polish matters):

- Header with app name from config.
- Input card: drag-and-drop / click-to-upload zone (multiple files, extensions from config) + paste-text textarea (if `allowText`). Selected files listed with name/size and a remove button.
- Destination input (optional), placeholder "webhook URL or email (optional)".
- "Run Pipeline" button with loading state.
- Results panel: rendered structured summary (title, bulleted key points, entities as chips, etc.) + collapsible raw JSON + delivery status line. In `per_file` mode, one summary card per input file.

Files are read client-side with `FileReader`; no upload/blob storage.

## Error handling

- Client: reject wrong extensions and over-cap payloads before sending, with inline messages.
- Server: validate extensions and size against config (400 with message); wrap pipeline run in try/catch and return per-step `status: "error"` with a readable message; Anthropic refusal stop reason surfaces as a step error rather than crashing.

## Testing

Manual QA only (explicit no-TDD decision for this project). Two fixture files in `fixtures/`: a messy CSV and a long text dump. Acceptance: upload fixtures → structured summary renders → webhook.site receives the JSON payload → email arrives via Resend. The Loom demo is the acceptance test.

## Demo talking points — "can it also do X?"

Philosophy: build the intent (an intake machine: messy input → structured, routable data), not just the ask. Prepared answers:

- **Yes, via config (zero code):** extract sentiment / flag PII / output in another language (add a schema field or edit the prompt), a different analysis entirely (add an `llm` step), accept new file types (edit `input.accept`), one summary per file (`input.mode: "per_file"`).
- **No, out of spec — and say so plainly:** OCR/PDFs/images, persistence/history, auth. Possible follow-ups, not in this build.

## Build order (~60 min)

1. Scaffold Next.js app, install `@anthropic-ai/sdk`, `resend`.
2. `pipeline.config.json` + `lib/pipeline.ts` runner + `/api/run` + `/api/config`.
3. Landing page UI wired to config.
4. Delivery: webhook POST + Resend email.
5. Deploy to Vercel, set env vars.
6. Record Loom: live demo with webhook.site, code walkthrough, "can it also do X?" answer (add a step / edit `input.accept` — zero code changes).
