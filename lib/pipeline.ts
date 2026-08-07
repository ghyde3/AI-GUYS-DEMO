import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";

export type InputFile = { name: string; content: string };

type ScalarType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "date-time"
  | "email"
  | "uri";

/** A config field type: any scalar, or the same with `[]` for a list. */
export type FieldType = ScalarType | `${ScalarType}[]`;

export type LlmStep = {
  type: "llm";
  id: string;
  prompt: string;
  schema: Record<string, FieldType>;
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
  delivery?: { from?: string; defaultTarget?: string };
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

const SCALARS: Record<string, Record<string, unknown>> = {
  string: { type: "string" },
  number: { type: "number" },
  integer: { type: "integer" },
  boolean: { type: "boolean" },
  date: { type: "string", format: "date" },
  "date-time": { type: "string", format: "date-time" },
  email: { type: "string", format: "email" },
  uri: { type: "string", format: "uri" },
};

// Expand the config's shorthand ("number", "date[]", ...) into a real JSON
// schema for structured outputs. A trailing [] makes it a list of that type.
function toJsonSchema(shorthand: LlmStep["schema"]) {
  const properties: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(shorthand)) {
    const isList = kind.endsWith("[]");
    const scalar = SCALARS[isList ? kind.slice(0, -2) : kind];
    if (!scalar) {
      throw new Error(
        `Unknown type "${kind}" for field "${key}". Supported: ${Object.keys(
          SCALARS
        ).join(", ")} — append [] for a list.`
      );
    }
    properties[key] = isList ? { type: "array", items: scalar } : scalar;
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

async function deliver(target: string, payload: unknown, config: PipelineConfig) {
  const configName = config.name;
  if (target.includes("@")) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: config.delivery?.from ?? "Pipeline Demo <onboarding@resend.dev>",
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
        const output = await deliver(target, payload, config);
        results.push({ id, type: "deliver", status: "ok", output });
      } catch (e) {
        results.push({ id, type: "deliver", status: "error", error: errMsg(e) });
      }
    }
  }
  return results;
}
