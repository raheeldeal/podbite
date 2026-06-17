export type LengthPreset = "quick" | "standard" | "deep";

// Summarize one episode, or the whole show. "series" is a Day-2 feature
// (currently surfaced as "coming soon" in the UI).
export type SummaryScope = "episode" | "series";

export interface Episode {
  videoId: string;
  title: string;
  url: string;
  publishedText?: string;
}

export interface EpisodeWithTranscript extends Episode {
  transcript: string | null; // null = no captions available
}

export interface EpisodeSummary {
  videoId: string;
  title: string;
  url: string;
  summary: string; // ~300-500 word structured summary (the "map" output)
}

export interface IngestRequest {
  url: string;
  length: LengthPreset;
  scope?: SummaryScope; // defaults to "episode"
}

export interface IngestResponse {
  showTitle: string;
  episodeCount: number;
  skipped: { title: string; reason: string }[];
  synthesis: string; // final cross-episode markdown (the "reduce" output)
  transcript?: string; // full caption text, for the collapsible transcript view
  videoId?: string; // for follow-up calls (Ask)
  cached: boolean;
}
