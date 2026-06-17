import { claude, MAP_MODEL, REDUCE_MODEL } from "./anthropic";
import { cacheGet, cacheSet } from "./cache";
import type { EpisodeWithTranscript, EpisodeSummary, LengthPreset } from "./types";

// Bump this when you change a prompt — it invalidates only the affected cache layer
// without touching the (expensive-to-rebuild) transcripts.
const MAP_PROMPT_VERSION = "v1";
const REDUCE_PROMPT_VERSION = "v1";
const EPISODE_PROMPT_VERSION = "v1";

// Three length presets. `words` is the target length; `maxTokens` is the API
// budget (~1.6 tokens/word + headroom, kept well under the non-streaming limit);
// `depth` tunes how much explanation/context to include (Shortform-style:
// one-pager → comprehensive guide). The true multi-hour / 75k-word read needs
// chunked generation + stitching — deliberately deferred.
const LENGTH_TARGETS: Record<
  LengthPreset,
  { words: number; maxTokens: number; depth: string }
> = {
  quick: {
    words: 450,
    maxTokens: 1400,
    depth: "Give the essential gist — the core thesis and the 3–5 most important ideas, stated briefly.",
  },
  standard: {
    words: 1100,
    maxTokens: 3000,
    depth:
      "Cover the key ideas with enough explanation and concrete examples that a reader grasps the substance without hearing the episode.",
  },
  deep: {
    words: 2600,
    maxTokens: 6000,
    depth:
      "Write a comprehensive guide: all major ideas, supporting arguments, data, examples, nuances, and counterpoints, fully explained.",
  },
};

// Transcripts can be huge; cap what we feed a single model call to keep cost/latency sane.
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

// ── SINGLE EPISODE: one progressive, self-contained summary of ONE episode ────
// Unlike the map step (dense notes for a later cross-episode pass), this is the
// reader-facing output for "summarize this episode." One strong-model pass over
// the transcript, written like a Shortform guide: reorganized by idea, builds
// progressively, defines jargon inline. Cached by video id + length.
export async function summarizeSingleEpisode(
  ep: EpisodeWithTranscript,
  length: LengthPreset
): Promise<string | null> {
  if (!ep.transcript) return null;

  const target = LENGTH_TARGETS[length];
  const cacheKey = `episodeRead:${EPISODE_PROMPT_VERSION}:${length}:${ep.videoId}`;
  const hit = await cacheGet<string>(cacheKey);
  if (hit) return hit;

  const transcript =
    ep.transcript.length > MAP_TRANSCRIPT_CHAR_CAP
      ? ep.transcript.slice(0, MAP_TRANSCRIPT_CHAR_CAP) + " […transcript truncated]"
      : ep.transcript;

  const summary = await claude({
    model: REDUCE_MODEL,
    system:
      "You write a summary of a SINGLE podcast episode that reads like a Shortform guide to it — " +
      "not a timestamped bullet dump. Follow these rules:\n" +
      "- Reorganize by idea, not chronology. Order points so each builds on the last; never rely on a " +
      "concept you haven't already introduced (write progressively).\n" +
      "- The first time you use a technical or specialized term, add a short plain-English definition in " +
      "parentheses — e.g., \"churn (the rate at which customers stop paying)\".\n" +
      "- Lead with the episode's core thesis, then develop the supporting ideas, then the key takeaways.\n" +
      "- Be concrete: name who is speaking, and cite specific claims, data, and examples from the episode. " +
      "No filler, no \"in this episode the host discusses…\" preamble.\n" +
      "- Write in clean Markdown with short, scannable section headers.\n" +
      `- Depth: ${target.depth}\n` +
      `- Aim for roughly ${target.words} words.`,
    user: `Episode title: ${ep.title}\n\nTranscript:\n${transcript}`,
    maxTokens: target.maxTokens,
  });

  await cacheSet(cacheKey, summary);
  return summary;
}

// ── ASK: answer a question about one episode, grounded in its transcript ──────
export async function answerEpisodeQuestion(
  title: string,
  transcript: string,
  question: string
): Promise<string> {
  const ctx =
    transcript.length > MAP_TRANSCRIPT_CHAR_CAP
      ? transcript.slice(0, MAP_TRANSCRIPT_CHAR_CAP) + " […transcript truncated]"
      : transcript;

  return claude({
    model: REDUCE_MODEL,
    system:
      "You answer questions about a single podcast episode using ONLY its transcript. " +
      "Be direct and specific; quote or paraphrase what was actually said. If the transcript " +
      "doesn't cover the question, say so plainly rather than guessing. Define any technical term " +
      "in parentheses on first use. Keep it concise — a few sentences unless more is clearly needed.",
    user: `Episode: ${title}\n\nTranscript:\n${ctx}\n\nQuestion: ${question}`,
    maxTokens: 1000,
  });
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
