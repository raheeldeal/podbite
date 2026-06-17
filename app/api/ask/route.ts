import { NextRequest, NextResponse } from "next/server";
import { resolveSingleEpisode, fetchTranscript } from "@/lib/youtube";
import { answerEpisodeQuestion } from "@/lib/summarize";
import { cacheGet, cacheSet } from "@/lib/cache";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { url, question } = (await req.json()) as { url?: string; question?: string };
    if (!url || !question?.trim())
      return NextResponse.json({ error: "Missing url or question." }, { status: 400 });

    const { showTitle, episodes } = await resolveSingleEpisode(url);
    const ep = episodes[0];
    if (!ep) return NextResponse.json({ error: "No episode found for that URL." }, { status: 404 });

    // reuse the per-video transcript cache the summary path populated
    const tKey = `transcript:${ep.videoId}`;
    let transcript = await cacheGet<string | null>(tKey);
    if (transcript === null) {
      transcript = await fetchTranscript(ep.videoId);
      await cacheSet(tKey, transcript);
    }
    if (!transcript)
      return NextResponse.json({ error: "This episode has no usable captions." }, { status: 422 });

    const answer = await answerEpisodeQuestion(showTitle, transcript, question.trim());
    return NextResponse.json({ answer });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Something went wrong." }, { status: 500 });
  }
}
