import { NextResponse } from "next/server";
import config from "@/pipeline.config.json";

export function GET() {
  return NextResponse.json(config);
}
