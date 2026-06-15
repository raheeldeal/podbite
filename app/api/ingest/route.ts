import { NextRequest, NextResponse } from "next/server";
import { resolveEpisodes, fetchTranscript } from "@/lib/youtube";
import { summarizeEpisode, synthesize } from "@/lib/summarize";
import { cacheGet, cacheSet, idsHash } from "@/lib/cache";
import type { IngestRequest, IngestResponse, EpisodeSummary } from "@/lib/types";

// Long-running pipeline; fine for local `next dev`. (No serverless timeout locally.)
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { url, length } = (await req.json()) as IngestRequest;
    if (!url) return NextResponse.json({ error: "Missing url." }, { status: 400 });

    const maxEpisodes = Number(process.env.MAX_EPISODES || 10);
    const { showTitle, episodes } = await resolveEpisodes(url, maxEpisodes);
    if (episodes.length === 0)
      return NextResponse.json({ error: "No episodes found for that URL." }, { status: 404 });

    // ── synthesis-level cache: same show + same episodes + same length = free ──
    const synthKey = `synthesis:${length}:${idsHash(episodes.map((e) => e.videoId))}`;
    const cachedSynth = await cacheGet<IngestResponse>(synthKey);
    if (cachedSynth) return NextResponse.json({ ...cachedSynth, cached: true });

    // ── fetch transcripts (cached per video) ──────────────────────────────────
    const skipped: { title: string; reason: string }[] = [];
    const summaries: EpisodeSummary[] = [];

    for (const ep of episodes) {
      const tKey = `transcript:${ep.videoId}`;
      let transcript = await cacheGet<string | null>(tKey);
      if (transcript === null) {
        transcript = await fetchTranscript(ep.videoId);
        await cacheSet(tKey, transcript); // cache even null so we don't re-fetch dead ones
      }
      if (!transcript) {
        skipped.push({ title: ep.title, reason: "no captions" });
        continue;
      }
      const summary = await summarizeEpisode({ ...ep, transcript });
      if (summary) summaries.push(summary);
    }

    if (summaries.length === 0)
      return NextResponse.json(
        { error: "None of these episodes had usable captions." },
        { status: 422 }
      );

    // ── reduce ────────────────────────────────────────────────────────────────
    const synthesisText = await synthesize(showTitle, summaries, length);

    const response: IngestResponse = {
      showTitle,
      episodeCount: summaries.length,
      skipped,
      synthesis: synthesisText,
      cached: false,
    };
    await cacheSet(synthKey, response);
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Something went wrong." }, { status: 500 });
  }
}
