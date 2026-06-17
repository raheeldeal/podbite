import { NextRequest, NextResponse } from "next/server";
import { resolveSingleEpisode, fetchTranscript } from "@/lib/youtube";
import { summarizeSingleEpisode } from "@/lib/summarize";
import { cacheGet, cacheSet } from "@/lib/cache";
import type { IngestRequest, IngestResponse } from "@/lib/types";

// Single-episode runs finish well under a minute. 60s = Vercel Hobby max.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { url, length, scope = "episode" } = (await req.json()) as IngestRequest;
    if (!url) return NextResponse.json({ error: "Missing url." }, { status: 400 });

    // Whole-show synthesis (the cross-episode map-reduce) is a Day-2 feature — the
    // map/reduce pipeline lives in lib/summarize.ts (summarizeEpisode + synthesize)
    // for when we enable it. For now, single-episode only.
    if (scope === "series")
      return NextResponse.json(
        { error: 'Whole-show summaries are coming soon. Pick "This episode" for now.' },
        { status: 501 }
      );

    // ── single episode ────────────────────────────────────────────────────────
    const { showTitle, episodes } = await resolveSingleEpisode(url);
    if (episodes.length === 0)
      return NextResponse.json({ error: "No episode found for that URL." }, { status: 404 });
    const ep = episodes[0];

    // response-level cache: same episode + same length = free.
    // v2 adds transcript + videoId to the payload — bump invalidates old entries.
    const respKey = `episodeResp:v2:${length}:${ep.videoId}`;
    const cached = await cacheGet<IngestResponse>(respKey);
    if (cached) return NextResponse.json({ ...cached, cached: true });

    // transcript (cached per video; null cached too so we don't re-fetch dead ones)
    const tKey = `transcript:${ep.videoId}`;
    let transcript = await cacheGet<string | null>(tKey);
    if (transcript === null) {
      transcript = await fetchTranscript(ep.videoId);
      await cacheSet(tKey, transcript);
    }
    if (!transcript)
      return NextResponse.json(
        { error: "This episode has no usable captions." },
        { status: 422 }
      );

    const summary = await summarizeSingleEpisode({ ...ep, transcript }, length);
    if (!summary)
      return NextResponse.json({ error: "Couldn't summarize this episode." }, { status: 422 });

    const response: IngestResponse = {
      showTitle,
      episodeCount: 1,
      skipped: [],
      synthesis: summary,
      transcript,
      videoId: ep.videoId,
      cached: false,
    };
    await cacheSet(respKey, response);
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Something went wrong." }, { status: 500 });
  }
}
