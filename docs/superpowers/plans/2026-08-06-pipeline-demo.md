# Pipeline Demo (Messy Data Summarizer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed Next.js app that takes messy input (files or pasted text), runs it through a config-driven pipeline of Claude LLM steps with guaranteed-JSON output, and delivers the result to a webhook or email.

**Architecture:** One Next.js App Router project at repo root. `pipeline.config.json` is the single source of truth (accepted file types, mode, model, steps). `lib/pipeline.ts` runs the steps; `/api/run` executes a run; `/api/config` exposes the config to the frontend so the UI is config-driven too.

**Tech Stack:** Next.js (App Router, TypeScript, Tailwind v4), `@anthropic-ai/sdk` (model `claude-opus-5`, structured outputs via `output_config.format`), `resend` for email, plain `fetch` for webhooks. Deployed to Vercel.

## Global Constraints

- **No TDD for this project** (explicit user decision, recorded in spec). Verification is: dev server boots, curl/browser checks against fixtures, manual QA.
- Model is exactly `claude-opus-5`.
- Config file `pipeline.config.json` is the single source of truth for accepted extensions, size cap, mode, prompts, schemas, delivery.
- Env vars: `ANTHROPIC_API_KEY`, `RESEND_API_KEY` (already in `.env.local`; must also be set in Vercel).
- Email sender is `Pipeline Demo <onboarding@resend.dev>` (no domain verification needed).
- `pasted-text.txt` is always an accepted input name regardless of `input.accept`.
- Commit after every task.
- Do not touch `AI-GUYS-DEMO/` (separate empty repo, purpose unconfirmed).

---

### Task 1: Scaffold the Next.js project

**Files:**
- Create: `package.json` (via npm), `tsconfig.json`, `next-env.d.ts` (auto), `postcss.config.mjs`, `app/layout.tsx`, `app/globals.css`, `pipeline.config.json`

**Interfaces:**
- Produces: a bootable Next.js app; `pipeline.config.json` with the exact shape consumed by Task 2's `PipelineConfig` type; path alias `@/*` → repo root.

- [ ] **Step 1: Init package and install dependencies**

```bash
npm init -y
npm install next@latest react@latest react-dom@latest @anthropic-ai/sdk resend
npm install -D typescript @types/react @types/react-dom @types/node tailwindcss @tailwindcss/postcss postcss
```

- [ ] **Step 2: Set scripts in package.json**

Edit `package.json` scripts to:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start"
}
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "AI-GUYS-DEMO"]
}
```

- [ ] **Step 4: Write postcss.config.mjs (Tailwind v4)**

```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

- [ ] **Step 5: Write app/globals.css**

```css
@import "tailwindcss";
```

- [ ] **Step 6: Write app/layout.tsx**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Messy Data Summarizer",
  description: "Messy input in, structured summary out, delivered anywhere.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Write pipeline.config.json** (exact content from spec)

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
      "prompt": "Analyze the input files and produce a structured summary. Identify key points, named entities, data quality issues, and concrete action items. Be specific and reference the data.",
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

- [ ] **Step 8: Add a placeholder home page so the app boots**

`app/page.tsx`:

```tsx
export default function Home() {
  return <main className="p-8">Pipeline demo — UI coming in Task 3.</main>;
}
```

- [ ] **Step 9: Verify the dev server boots**

Run: `npm run dev` (background), then `curl -s http://localhost:3000 | head -c 200`
Expected: HTML containing "Pipeline demo".

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "Scaffold Next.js app with pipeline config"
```

---

### Task 2: Pipeline runner + API routes

**Files:**
- Create: `lib/pipeline.ts`, `app/api/run/route.ts`, `app/api/config/route.ts`

**Interfaces:**
- Consumes: `pipeline.config.json` (Task 1 shape), env vars `ANTHROPIC_API_KEY` / `RESEND_API_KEY`.
- Produces:
  - `runPipeline(config: PipelineConfig, files: InputFile[], destination?: string): Promise<StepResult[]>`
  - `InputFile = { name: string; content: string }`
  - `StepResult = { id: string; type: "llm" | "deliver"; status: "ok" | "error" | "skipped"; output?: unknown; error?: string }`
  - `POST /api/run` body `{ files: InputFile[], destination?: string }` → `{ steps: StepResult[] }` (400 on validation failure, 500 with `{ error }` on unexpected failure)
  - `GET /api/config` → the raw config JSON

- [ ] **Step 1: Write lib/pipeline.ts**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";

export type InputFile = { name: string; content: string };

export type LlmStep = {
  type: "llm";
  id: string;
  prompt: string;
  schema: Record<string, "string" | "string[]">;
};

export type DeliverStep = { type: "deliver"; id?: string; target: string };
export type Step = LlmStep | DeliverStep;

export type PipelineConfig = {
  name: string;
  model: string;
  input: {
    accept: string[];
    allowText: boolean;
    maxTotalKb: number;
    mode?: "combined" | "per_file";
  };
  delivery?: { defaultTarget?: string };
  steps: Step[];
};

export type StepResult = {
  id: string;
  type: Step["type"];
  status: "ok" | "error" | "skipped";
  output?: unknown;
  error?: string;
};

const anthropic = new Anthropic();

// Expand the config's shorthand ("string" / "string[]") into a real JSON schema
// for structured outputs.
function toJsonSchema(shorthand: LlmStep["schema"]) {
  const properties: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(shorthand)) {
    properties[key] =
      kind === "string[]"
        ? { type: "array", items: { type: "string" } }
        : { type: "string" };
  }
  return {
    type: "object",
    properties,
    required: Object.keys(shorthand),
    additionalProperties: false,
  };
}

function formatInput(files: InputFile[]): string {
  return files
    .map((f) => `<file name="${f.name}">\n${f.content}\n</file>`)
    .join("\n\n");
}

async function runLlmStep(
  step: LlmStep,
  model: string,
  input: string
): Promise<unknown> {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 16000,
    output_config: {
      format: { type: "json_schema", schema: toJsonSchema(step.schema) },
    },
    messages: [{ role: "user", content: `${step.prompt}\n\n${input}` }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to process this input.");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text) throw new Error("Model returned no output.");
  return JSON.parse(text.text);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function deliver(target: string, payload: unknown, configName: string) {
  if (target.includes("@")) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: "Pipeline Demo <onboarding@resend.dev>",
      to: target,
      subject: `${configName} — results`,
      html: `<h2>${escapeHtml(configName)}</h2><pre style="background:#f4f4f5;padding:12px;border-radius:8px;font-size:13px">${escapeHtml(
        JSON.stringify(payload, null, 2)
      )}</pre>`,
    });
    if (error) throw new Error(error.message);
    return { target, method: "email" as const };
  }
  if (target.startsWith("http")) {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Webhook responded with ${res.status}`);
    return { target, method: "webhook" as const };
  }
  throw new Error("Destination must be an email address or an http(s) URL.");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runPipeline(
  config: PipelineConfig,
  files: InputFile[],
  destination?: string
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const perFile = config.input.mode === "per_file";
  let payload: unknown = null; // output of the previous llm step

  for (const [i, step] of config.steps.entries()) {
    if (step.type === "llm") {
      try {
        if (perFile) {
          const out: { file: string; summary: unknown }[] = [];
          for (const f of files) {
            const input =
              payload == null ? formatInput([f]) : JSON.stringify(payload);
            out.push({
              file: f.name,
              summary: await runLlmStep(step, config.model, input),
            });
          }
          payload = out;
        } else {
          const input =
            payload == null ? formatInput(files) : JSON.stringify(payload);
          payload = await runLlmStep(step, config.model, input);
        }
        results.push({ id: step.id, type: "llm", status: "ok", output: payload });
      } catch (e) {
        results.push({ id: step.id, type: "llm", status: "error", error: errMsg(e) });
        return results; // downstream steps depend on this output
      }
    } else {
      const id = step.id ?? `deliver-${i}`;
      const target =
        step.target === "auto"
          ? destination?.trim() || config.delivery?.defaultTarget?.trim()
          : step.target;
      if (!target) {
        results.push({ id, type: "deliver", status: "skipped", error: "no destination" });
        continue;
      }
      try {
        const output = await deliver(target, payload, config.name);
        results.push({ id, type: "deliver", status: "ok", output });
      } catch (e) {
        results.push({ id, type: "deliver", status: "error", error: errMsg(e) });
      }
    }
  }
  return results;
}
```

Note: if the installed SDK's TypeScript types don't yet include `output_config` on `messages.create`, cast the request object: `...create({...} as Anthropic.MessageCreateParamsNonStreaming)` or append `// @ts-expect-error output_config newer than SDK types` — the API accepts the field.

- [ ] **Step 2: Write app/api/config/route.ts**

```ts
import { NextResponse } from "next/server";
import config from "@/pipeline.config.json";

export function GET() {
  return NextResponse.json(config);
}
```

- [ ] **Step 3: Write app/api/run/route.ts**

```ts
import { NextResponse } from "next/server";
import config from "@/pipeline.config.json";
import {
  runPipeline,
  type InputFile,
  type PipelineConfig,
} from "@/lib/pipeline";

export const maxDuration = 300; // Claude steps can take a while

const cfg = config as PipelineConfig;

export async function POST(req: Request) {
  let body: { files?: InputFile[]; destination?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    /* fall through to validation */
  }
  if (!body || !Array.isArray(body.files) || body.files.length === 0) {
    return NextResponse.json({ error: "No input provided." }, { status: 400 });
  }

  const totalKb =
    body.files.reduce((n, f) => n + (f.content?.length ?? 0), 0) / 1024;
  if (totalKb > cfg.input.maxTotalKb) {
    return NextResponse.json(
      { error: `Input exceeds ${cfg.input.maxTotalKb}KB limit.` },
      { status: 400 }
    );
  }

  for (const f of body.files) {
    const name = (f.name ?? "").toLowerCase();
    const ok =
      name === "pasted-text.txt" ||
      cfg.input.accept.some((ext) => name.endsWith(ext));
    if (!ok) {
      return NextResponse.json(
        { error: `File type not accepted: ${f.name}` },
        { status: 400 }
      );
    }
  }

  try {
    const steps = await runPipeline(cfg, body.files, body.destination);
    return NextResponse.json({ steps });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Pipeline failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify against the live API**

With the dev server running:

```bash
curl -s http://localhost:3000/api/config | head -c 120
curl -s -X POST http://localhost:3000/api/run \
  -H 'Content-Type: application/json' \
  -d '{"files":[{"name":"test.txt","content":"Meeting notes: Bob to send Q3 numbers to Alice by Friday. Budget concerns re: vendor Acme, invoice 4402 unpaid."}]}'
```

Expected: config JSON snippet; then `{"steps":[{"id":"summarize","type":"llm","status":"ok","output":{...}},{"id":"deliver-1","type":"deliver","status":"skipped",...}]}` with a plausible structured summary.

Also verify a rejected extension returns 400:

```bash
curl -s -X POST http://localhost:3000/api/run -H 'Content-Type: application/json' \
  -d '{"files":[{"name":"evil.exe","content":"x"}]}'
```

Expected: `{"error":"File type not accepted: evil.exe"}`.

- [ ] **Step 5: Commit**

```bash
git add lib app/api && git commit -m "Add pipeline runner and API routes"
```

---

### Task 3: Landing page UI

**Files:**
- Modify: `app/page.tsx` (replace placeholder entirely)

**Interfaces:**
- Consumes: `GET /api/config` (config shape from Task 1), `POST /api/run` (contract from Task 2).

- [ ] **Step 1: Write app/page.tsx**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Config = {
  name: string;
  input: {
    accept: string[];
    allowText: boolean;
    maxTotalKb: number;
    mode?: string;
  };
};

type Picked = { name: string; content: string };

type StepResult = {
  id: string;
  type: "llm" | "deliver";
  status: "ok" | "error" | "skipped";
  output?: unknown;
  error?: string;
};

function isPerFileOutput(o: unknown): o is { file: string; summary: unknown }[] {
  return (
    Array.isArray(o) &&
    o.every((x) => x && typeof x === "object" && "file" in x && "summary" in x)
  );
}

function SummaryCard({ data, title }: { data: unknown; title?: string }) {
  if (data === null || typeof data !== "object") return null;
  const entries = Object.entries(data as Record<string, unknown>);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
      {title && (
        <p className="text-xs font-mono uppercase tracking-wider text-cyan-400">
          {title}
        </p>
      )}
      {entries.map(([key, value]) => {
        const label = key.replace(/_/g, " ");
        if (typeof value === "string") {
          return (
            <div key={key}>
              {key === "title" ? (
                <h3 className="text-lg font-semibold text-slate-100">{value}</h3>
              ) : (
                <>
                  <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">
                    {label}
                  </p>
                  <p className="text-sm text-slate-300">{value}</p>
                </>
              )}
            </div>
          );
        }
        if (Array.isArray(value)) {
          if (value.length === 0) return null;
          const chips = key === "entities";
          return (
            <div key={key}>
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
                {label}
              </p>
              {chips ? (
                <div className="flex flex-wrap gap-1.5">
                  {value.map((v, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-cyan-950 border border-cyan-800 px-2.5 py-0.5 text-xs text-cyan-300"
                    >
                      {String(v)}
                    </span>
                  ))}
                </div>
              ) : (
                <ul className="list-disc list-inside space-y-1 text-sm text-slate-300">
                  {value.map((v, i) => (
                    <li key={i}>{String(v)}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

export default function Home() {
  const [config, setConfig] = useState<Config | null>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [pasted, setPasted] = useState("");
  const [destination, setDestination] = useState("");
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StepResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setError("Could not load pipeline config."));
  }, []);

  const accept = config?.input.accept ?? [];
  const maxKb = config?.input.maxTotalKb ?? 150;

  async function addFiles(list: FileList | null) {
    if (!list || !config) return;
    setError(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      const ok = accept.some((ext) => file.name.toLowerCase().endsWith(ext));
      if (!ok) {
        setError(`"${file.name}" skipped — accepted types: ${accept.join(", ")}`);
        continue;
      }
      const content = await file.text();
      next.push({ name: file.name, content });
    }
    setFiles(next);
  }

  const totalKb =
    (files.reduce((n, f) => n + f.content.length, 0) + pasted.length) / 1024;
  const overCap = totalKb > maxKb;

  async function run() {
    if (!config) return;
    setRunning(true);
    setError(null);
    setResults(null);
    const payload: Picked[] = [...files];
    if (pasted.trim()) {
      payload.push({ name: "pasted-text.txt", content: pasted });
    }
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: payload,
          destination: destination || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResults(data.steps);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  const canRun =
    !running && !overCap && (files.length > 0 || pasted.trim().length > 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          {config?.name ?? "…"}
        </h1>
        <p className="text-slate-400">
          Drop in messy files or paste raw text — get back a structured
          summary, delivered wherever you want it.
        </p>
      </header>

      <section className="space-y-4">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
            dragOver
              ? "border-cyan-400 bg-cyan-950/30"
              : "border-slate-700 hover:border-slate-500"
          }`}
        >
          <p className="font-medium">Click to upload or drag files here</p>
          <p className="mt-1 text-sm text-slate-500">
            {accept.join(", ")} · up to {maxKb}KB total
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept.join(",")}
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between rounded-lg bg-slate-900 px-3 py-2 text-sm"
              >
                <span>
                  {f.name}{" "}
                  <span className="text-slate-500">
                    ({(f.content.length / 1024).toFixed(1)}KB)
                  </span>
                </span>
                <button
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="text-slate-500 hover:text-red-400"
                  aria-label={`Remove ${f.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {config?.input.allowText && (
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="…or paste a long messy string here (meeting notes, email threads, logs)"
            rows={5}
            className="w-full rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
          />
        )}

        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Webhook URL or email (optional)"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
        />

        {overCap && (
          <p className="text-sm text-amber-400">
            Input is {totalKb.toFixed(0)}KB — over the {maxKb}KB limit. Remove
            something.
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={run}
          disabled={!canRun}
          className="w-full rounded-xl bg-cyan-500 py-3 font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
        >
          {running ? "Running pipeline…" : "Run Pipeline"}
        </button>
      </section>

      {results && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Results</h2>
          {results.map((step) => (
            <div key={step.id} className="space-y-3">
              {step.type === "llm" && step.status === "ok" && (
                <>
                  {isPerFileOutput(step.output) ? (
                    step.output.map((item) => (
                      <SummaryCard
                        key={item.file}
                        data={item.summary}
                        title={item.file}
                      />
                    ))
                  ) : (
                    <SummaryCard data={step.output} />
                  )}
                </>
              )}
              {step.type === "llm" && step.status === "error" && (
                <p className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                  Step “{step.id}” failed: {step.error}
                </p>
              )}
              {step.type === "deliver" && (
                <p
                  className={`rounded-lg border px-4 py-3 text-sm ${
                    step.status === "ok"
                      ? "border-emerald-900 bg-emerald-950/40 text-emerald-300"
                      : step.status === "skipped"
                        ? "border-slate-800 bg-slate-900/60 text-slate-400"
                        : "border-red-900 bg-red-950/40 text-red-300"
                  }`}
                >
                  {step.status === "ok" &&
                    `Delivered via ${(step.output as { method: string }).method} → ${(step.output as { target: string }).target}`}
                  {step.status === "skipped" && "Delivery skipped — no destination provided."}
                  {step.status === "error" && `Delivery failed: ${step.error}`}
                </p>
              )}
            </div>
          ))}
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-300">
              Raw JSON
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-400">
              {JSON.stringify(results, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify in the browser**

With dev server running, open the preview at `http://localhost:3000`. Check: header shows config name; dropzone hint lists extensions from config; textarea present; run with pasted text only → summary card renders; deliver line shows "skipped".

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx && git commit -m "Add config-driven landing page UI"
```

---

### Task 4: Fixtures + manual QA pass

**Files:**
- Create: `fixtures/messy-sales.csv`, `fixtures/meeting-notes.txt`

**Interfaces:**
- Consumes: the full running app.

- [ ] **Step 1: Write fixtures/messy-sales.csv**

```csv
Date,Customer,Item,Qty,Price,notes
2026-07-01,Acme Corp,Widget A,10,25.00,
07/02/2026,acme corp,Widget A,5,$25,duplicate customer??
2026-07-03,Beta LLC,Widget B,,30.00,qty missing
2026-07-04,Gamma Inc,widget b,3,30,
2026-07-05,Acme Corp,Widget C,2,,price TBD - call Susan
2026-07-08,Delta Co,Widget A,100,22.50,bulk discount applied
2026-07-09,,Widget B,7,30.00,customer field blank!!
2026-07-10,Beta LLC,Widget B,4,thirty,price typed as word
```

- [ ] **Step 2: Write fixtures/meeting-notes.txt**

```
ok so quick brain dump from the tuesday sync before i forget -- sarah wants the
onboarding flow redone before the pitch on the 21st, mike pushed back saying the
API migration has to land first (he thinks 2 weeks?? seems optimistic). Legal
flagged the data retention thing AGAIN, third time now, someone needs to own it,
probably jen. oh and the acme contract renews aug 15 and nobody has looked at the
new pricing terms. random: the staging server keeps falling over when QA runs the
big import, dave suspects the connection pool. also we agreed (i think?) to move
standup to 9:30. Karen from finance wants Q3 projections by EOW which is friday.
```

- [ ] **Step 3: Full manual QA**

1. Upload both fixtures together + type a `https://webhook.site/...` URL (generate one at webhook.site) → run → summary renders, webhook.site shows the JSON payload.
2. Run again with an email destination (user's own email) → email arrives from `onboarding@resend.dev`.
3. Flip `pipeline.config.json` → `"mode": "per_file"`, re-run with both fixtures → two summary cards. Flip back to `"combined"`.
4. Try dropping a disallowed file (e.g. `.png`) → inline "skipped" message.

- [ ] **Step 4: Commit**

```bash
git add fixtures && git commit -m "Add QA fixtures"
```

---

### Task 5: Deploy to Vercel

**Files:**
- None new (Vercel picks up the Next.js build).

**Interfaces:**
- Consumes: the committed app; env var values from `.env.local`.

- [ ] **Step 1: Deploy**

Preferred: use the session's Vercel MCP `deploy_to_vercel` tool. Fallback CLI:

```bash
npx vercel deploy --prod --yes
```

- [ ] **Step 2: Set env vars on the Vercel project**

`ANTHROPIC_API_KEY` and `RESEND_API_KEY` (values from `.env.local`) for the Production environment, then redeploy if they weren't set before the first build.

- [ ] **Step 3: Verify production**

Open the production URL: run the pasted-text flow end to end, including a webhook.site delivery.

- [ ] **Step 4: Commit any deploy artifacts and tag done**

```bash
git add -A && git commit -m "Vercel deploy config" --allow-empty
```

---

## Self-review notes

- Spec coverage: config-driven inputs (T1/T3), text box (T3), per_file mode (T2/T3/T4 QA), structured outputs + refusal handling (T2), delivery email/webhook/skip (T2), validation both sides (T2/T3), fixtures + acceptance flow (T4), deploy (T5). Demo talking points need no build.
- Types consistent across tasks (`InputFile`, `StepResult`, `PipelineConfig` defined once in T2, consumed by name in T3).
- No TDD per explicit user decision; each task ends with a runnable verification instead.
