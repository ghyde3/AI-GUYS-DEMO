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
                  {step.status === "skipped" &&
                    "Delivery skipped — no destination provided."}
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
