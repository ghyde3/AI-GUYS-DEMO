"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  FileText,
  History,
  Loader2,
  Mail,
  Paperclip,
  Plus,
  Sparkles,
  Webhook,
  X,
} from "lucide-react";

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

type HistoryItem = {
  ts: number;
  steps: StepResult[];
  inputs: { files: string[]; pasted: boolean; destination?: string };
};

const HISTORY_KEY = "mds-history-v1";
const HISTORY_MAX = 20;

function isPerFileOutput(o: unknown): o is { file: string; summary: unknown }[] {
  return (
    Array.isArray(o) &&
    o.every((x) => x && typeof x === "object" && "file" in x && "summary" in x)
  );
}

function SummaryCard({
  data,
  title,
  index = 0,
}: {
  data: unknown;
  title?: string;
  index?: number;
}) {
  if (data === null || typeof data !== "object") return null;
  const entries = Object.entries(data as Record<string, unknown>);
  return (
    <div
      className="animate-fade-up rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      {title && (
        <p className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-cyan-400">
          <FileText className="h-3.5 w-3.5" aria-hidden />
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
                      className="rounded-full bg-cyan-950 border border-cyan-800 px-2.5 py-0.5 text-xs text-cyan-300 transition-colors hover:border-cyan-500 hover:text-cyan-100"
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

function DeliverLine({ step }: { step: StepResult }) {
  return (
    <p
      className={`animate-fade-in flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
        step.status === "ok"
          ? "border-emerald-900 bg-emerald-950/40 text-emerald-300"
          : step.status === "skipped"
            ? "border-slate-800 bg-slate-900/60 text-slate-400"
            : "border-red-900 bg-red-950/40 text-red-300"
      }`}
    >
      {step.status === "ok" && (
        <>
          {(step.output as { method: string }).method === "email" ? (
            <Mail className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Webhook className="h-4 w-4 shrink-0" aria-hidden />
          )}
          Delivered via {(step.output as { method: string }).method} →{" "}
          {(step.output as { target: string }).target}
          <CheckCircle2 className="ml-auto h-4 w-4 shrink-0" aria-hidden />
        </>
      )}
      {step.status === "skipped" && (
        <>
          <CircleSlash className="h-4 w-4 shrink-0" aria-hidden />
          Delivery skipped — no destination provided.
        </>
      )}
      {step.status === "error" && (
        <>
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          Delivery failed: {step.error}
        </>
      )}
    </p>
  );
}

export default function Home() {
  const [config, setConfig] = useState<Config | null>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [pasted, setPasted] = useState("");
  const [destination, setDestination] = useState("");
  const [running, setRunning] = useState(false);
  const [destFocused, setDestFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setError("Could not load pipeline config."));
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch {
      /* corrupted or unavailable storage — start fresh */
    }
  }, []);

  function saveHistory(h: HistoryItem[]) {
    setHistory(h);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    } catch {
      /* storage full or blocked — history stays in memory */
    }
  }

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
      const item: HistoryItem = {
        ts: Date.now(),
        steps: data.steps,
        inputs: {
          files: files.map((f) => f.name),
          pasted: pasted.trim().length > 0,
          destination: destination || undefined,
        },
      };
      const h = [...history, item].slice(-HISTORY_MAX);
      saveHistory(h);
      setViewIndex(h.length - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setRunning(false);
    }
  }

  const canRun =
    !running && !overCap && (files.length > 0 || pasted.trim().length > 0);

  const viewing = viewIndex !== null ? history[viewIndex] : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
      <header className="animate-fade-up space-y-2">
        <h1 className="flex items-center gap-2.5 text-3xl font-bold tracking-tight">
          <Sparkles className="h-7 w-7 text-cyan-400" aria-hidden />
          {config?.name ?? "…"}
        </h1>
        <p className="text-slate-400">
          Drop in messy files or paste raw text — get back a structured
          summary, delivered wherever you want it.
        </p>
      </header>

      {!viewing && (
        <section
          className="animate-fade-up space-y-3"
          style={{ animationDelay: "90ms" }}
        >
          <div
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
            className={`rounded-xl border-2 border-dashed transition-all duration-200 ${
              dragOver
                ? "scale-[1.01] border-cyan-400 bg-cyan-950/30"
                : "border-slate-700 bg-slate-900/40 focus-within:border-cyan-600"
            }`}
          >
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Paste messy text here — or drop files anywhere in this box"
              rows={6}
              className="w-full resize-none bg-transparent p-4 text-sm placeholder:text-slate-500 focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800 px-3 py-2">
              <button
                onClick={() => inputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <Paperclip className="h-4 w-4" aria-hidden />
                Attach files
              </button>
              <span className="text-xs text-slate-600">
                {accept.join(", ")} · up to {maxKb}KB
              </span>
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
              <div className="ml-auto flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span
                    key={`${f.name}-${i}`}
                    className="animate-fade-in flex items-center gap-1 rounded-full bg-slate-800 py-0.5 pl-2.5 pr-1 text-xs text-slate-300"
                  >
                    <FileText className="h-3 w-3 text-cyan-500" aria-hidden />
                    {f.name}
                    <button
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="rounded-full p-0.5 text-slate-500 transition-colors hover:bg-red-950 hover:text-red-400"
                      aria-label={`Remove ${f.name}`}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              onFocus={() => setDestFocused(true)}
              onBlur={() => setDestFocused(false)}
              placeholder="Send to webhook or email (optional)"
              className={`min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm placeholder:text-slate-600 transition-all duration-300 ease-out focus:border-cyan-500 focus:outline-none ${
                destFocused ? "sm:basis-1/2" : "sm:basis-[30%]"
              }`}
            />
            <button
              onClick={run}
              disabled={!canRun}
              className={`flex min-w-0 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 font-semibold text-slate-950 transition-all duration-300 ease-out hover:bg-cyan-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-cyan-900 disabled:text-cyan-200 ${
                destFocused ? "sm:basis-1/2" : "sm:basis-[70%]"
              }`}
            >
              {running ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Unmessing…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Unmess It
                </>
              )}
            </button>
          </div>

          {overCap && (
            <p className="animate-fade-in flex items-center gap-1.5 text-sm text-amber-400">
              <AlertCircle className="h-4 w-4" aria-hidden />
              Input is {totalKb.toFixed(0)}KB — over the {maxKb}KB limit.
              Remove something.
            </p>
          )}
          {error && (
            <p className="animate-fade-in flex items-center gap-1.5 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" aria-hidden />
              {error}
            </p>
          )}

          {history.length > 0 && (
            <button
              onClick={() => setViewIndex(history.length - 1)}
              className="flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-300"
            >
              <History className="h-4 w-4" aria-hidden />
              View past results ({history.length})
            </button>
          )}
        </section>
      )}

      {viewing && (
        <section className="animate-fade-up space-y-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewIndex(null)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-200"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </button>
            <button
              onClick={() => {
                setFiles([]);
                setPasted("");
                setDestination("");
                setError(null);
                setViewIndex(null);
              }}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-200"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New
            </button>
            <div className="ml-auto flex items-center gap-1 text-sm text-slate-500">
              <button
                onClick={() => setViewIndex((i) => (i ?? 0) - 1)}
                disabled={viewIndex === 0}
                className="rounded-lg p-1.5 transition-colors hover:bg-slate-900 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Previous result"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <span className="tabular-nums">
                {(viewIndex ?? 0) + 1} / {history.length}
              </span>
              <button
                onClick={() => setViewIndex((i) => (i ?? 0) + 1)}
                disabled={viewIndex === history.length - 1}
                className="rounded-lg p-1.5 transition-colors hover:bg-slate-900 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Next result"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            {new Date(viewing.ts).toLocaleString()} ·{" "}
            {[
              ...viewing.inputs.files,
              ...(viewing.inputs.pasted ? ["pasted text"] : []),
            ].join(", ") || "no input recorded"}
          </p>

          {viewing.steps.map((step) => (
            <div key={step.id} className="space-y-3">
              {step.type === "llm" && step.status === "ok" && (
                <>
                  {isPerFileOutput(step.output) ? (
                    step.output.map((item, i) => (
                      <SummaryCard
                        key={item.file}
                        data={item.summary}
                        title={item.file}
                        index={i}
                      />
                    ))
                  ) : (
                    <SummaryCard data={step.output} />
                  )}
                </>
              )}
              {step.type === "llm" && step.status === "error" && (
                <p className="animate-fade-in flex items-center gap-2 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                  Step “{step.id}” failed: {step.error}
                </p>
              )}
              {step.type === "deliver" && <DeliverLine step={step} />}
            </div>
          ))}

          <details className="group text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-slate-500 transition-colors hover:text-slate-300">
              <ChevronRight
                className="h-4 w-4 transition-transform duration-200 group-open:rotate-90"
                aria-hidden
              />
              Raw JSON
            </summary>
            <pre className="animate-fade-in mt-2 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-400">
              {JSON.stringify(viewing.steps, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </main>
  );
}
