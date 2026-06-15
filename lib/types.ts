export type LengthPreset = "quick" | "deep";

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
}

export interface IngestResponse {
  showTitle: string;
  episodeCount: number;
  skipped: { title: string; reason: string }[];
  synthesis: string; // final cross-episode markdown (the "reduce" output)
  cached: boolean;
}
