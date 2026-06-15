import { claude, MAP_MODEL, REDUCE_MODEL } from "./anthropic";
import { cacheGet, cacheSet } from "./cache";
import type { EpisodeWithTranscript, EpisodeSummary, LengthPreset } from "./types";

// Bump this when you change a prompt — it invalidates only the affected cache layer
// without touching the (expensive-to-rebuild) transcripts.
const MAP_PROMPT_VERSION = "v1";
const REDUCE_PROMPT_VERSION = "v1";

// Target word counts per preset. "deep" is capped here; a true multi-hour /
// 75k-word read needs chunked generation + stitching — deliberately deferred.
const LENGTH_TARGETS: Record<LengthPreset, { words: number; maxTokens: number }> = {
  quick: { words: 1000, maxTokens: 2200 },
  deep: { words: 3500, maxTokens: 6500 },
};

// Transcripts can be huge; cap what we feed the map step to keep cost/latency sane.
const MAP_TRANSCRIPT_CHAR_CAP = 45000;

// ── MAP: one structured summary per episode, cached by video id ───────────────
export async function summarizeEpisode(ep: EpisodeWithTranscript): Promise<EpisodeSummary | null> {
  if (!ep.transcript) return null;

  const cacheKey = `episodeSummary:${MAP_PROMPT_VERSION}:${ep.videoId}`;
  const hit = await cacheGet<EpisodeSummary>(cacheKey);
  if (hit) return hit;

  const transcript =
    ep.transcript.length > MAP_TRANSCRIPT_CHAR_CAP
      ? ep.transcript.slice(0, MAP_TRANSCRIPT_CHAR_CAP) + " […transcript truncated]"
      : ep.transcript;

  const summary = await claude({
    model: MAP_MODEL,
    system:
      "You summarize a single podcast episode into dense, faithful notes that a later pass will " +
      "synthesize across many episodes. Capture the core thesis, the main points and supporting " +
      "arguments, any notable claims or data, the guest (if any) and their stance, and 1–2 verbatim-flavored " +
      "key lines (paraphrased, not quoted at length). No preamble, no fluff. 250–450 words.",
    user: `Episode title: ${ep.title}\n\nTranscript:\n${transcript}`,
    maxTokens: 900,
  });

  const result: EpisodeSummary = { videoId: ep.videoId, title: ep.title, url: ep.url, summary };
  await cacheSet(cacheKey, result);
  return result;
}

// ── REDUCE: synthesize across all episode summaries at the target length ──────
export async function synthesize(
  showTitle: string,
  summaries: EpisodeSummary[],
  length: LengthPreset
): Promise<string> {
  const target = LENGTH_TARGETS[length];

  const corpus = summaries
    .map((s, i) => `### Episode ${i + 1}: ${s.title}\n${s.summary}`)
    .join("\n\n");

  return claude({
    model: REDUCE_MODEL,
    system:
      "You are writing a synthesis across an entire podcast show, given per-episode summaries. " +
      "Do NOT summarize episodes one by one. Instead surface what only emerges across the whole body of work: " +
      "the show's through-line and worldview, recurring themes, how the host's or guests' thinking evolves over time, " +
      "tensions or disagreements between episodes, and the strongest ideas worth taking away. " +
      "Write in clean Markdown with clear section headers. Be specific and cite episodes by title inline where useful. " +
      `Aim for roughly ${target.words} words — a reader should be able to skip the show and still grasp its substance. ` +
      "End with a short '## Episode index' listing each episode title in one line.",
    user: `Show: ${showTitle}\nEpisodes analyzed: ${summaries.length}\n\nPer-episode summaries:\n\n${corpus}`,
    maxTokens: target.maxTokens,
  });
}
