import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { synthesizeSpeech } from "@/lib/tts";

// Chunked deep summaries make several sequential OpenAI calls. 60s = Vercel Hobby max.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { text } = (await req.json()) as { text?: string };
    if (!text || !text.trim())
      return NextResponse.json({ error: "Missing text." }, { status: 400 });

    const cacheId = crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
    const base64 = await synthesizeSpeech(cacheId, text);

    return new NextResponse(Buffer.from(base64, "base64"), {
      headers: {
        "content-type": "audio/mpeg",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Couldn't generate audio." }, { status: 500 });
  }
}
