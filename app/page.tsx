"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  FileText,
  Loader2,
  Mail,
  Sparkles,
  UploadCloud,
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

      <section
        className="animate-fade-up space-y-4"
        style={{ animationDelay: "90ms" }}
      >
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
          className={`group cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all duration-200 ${
            dragOver
              ? "scale-[1.01] border-cyan-400 bg-cyan-950/30"
              : "border-slate-700 hover:border-slate-500 hover:bg-slate-900/40"
          }`}
        >
          <UploadCloud
            className={`mx-auto mb-3 h-9 w-9 transition-all duration-200 ${
              dragOver
                ? "-translate-y-1 text-cyan-400"
                : "text-slate-500 group-hover:-translate-y-1 group-hover:text-slate-300"
            }`}
            aria-hidden
          />
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
                className="animate-fade-in flex items-center justify-between rounded-lg bg-slate-900 px-3 py-2 text-sm transition-colors hover:bg-slate-800/80"
              >
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-500" aria-hidden />
                  {f.name}{" "}
                  <span className="text-slate-500">
                    ({(f.content.length / 1024).toFixed(1)}KB)
                  </span>
                </span>
                <button
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="rounded p-1 text-slate-500 transition-colors hover:bg-red-950/50 hover:text-red-400"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="h-4 w-4" aria-hidden />
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
            className="w-full rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm placeholder:text-slate-600 transition-colors focus:border-cyan-500 focus:outline-none"
          />
        )}

        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Webhook URL or email (optional)"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm placeholder:text-slate-600 transition-colors focus:border-cyan-500 focus:outline-none"
        />

        {overCap && (
          <p className="animate-fade-in flex items-center gap-1.5 text-sm text-amber-400">
            <AlertCircle className="h-4 w-4" aria-hidden />
            Input is {totalKb.toFixed(0)}KB — over the {maxKb}KB limit. Remove
            something.
          </p>
        )}
        {error && (
          <p className="animate-fade-in flex items-center gap-1.5 text-sm text-red-400">
            <AlertCircle className="h-4 w-4" aria-hidden />
            {error}
          </p>
        )}

        <button
          onClick={run}
          disabled={!canRun}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 font-semibold text-slate-950 transition-all duration-150 hover:bg-cyan-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Running pipeline…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden />
              Run Pipeline
            </>
          )}
        </button>
      </section>

      {results && (
        <section className="animate-fade-up space-y-4">
          <h2 className="text-xl font-semibold">Results</h2>
          {results.map((step) => (
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
              {step.type === "deliver" && (
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
                      <CheckCircle2
                        className="ml-auto h-4 w-4 shrink-0"
                        aria-hidden
                      />
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
              )}
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
              {JSON.stringify(results, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </main>
  );
}
