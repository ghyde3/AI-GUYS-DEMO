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
