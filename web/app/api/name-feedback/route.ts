import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile } from "fs/promises";
import path from "path";

const FEEDBACK_PATH = path.join(process.cwd(), "public", "name-feedback.json");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  try {
    const data = await readFile(FEEDBACK_PATH, "utf-8");
    return NextResponse.json(JSON.parse(data), { headers: corsHeaders });
  } catch {
    return NextResponse.json({}, { headers: corsHeaders });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await writeFile(FEEDBACK_PATH, JSON.stringify(body, null, 2), "utf-8");
    return NextResponse.json({ ok: true }, { headers: corsHeaders });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: corsHeaders }
    );
  }
}
