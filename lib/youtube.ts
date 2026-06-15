import { Innertube } from "youtubei.js";
import type { Episode } from "./types";

// ── NOTE ─────────────────────────────────────────────────────────────────────
// This is the only file that talks to YouTube. youtubei.js scrapes the same
// internal API the website uses, so it occasionally breaks when YouTube changes
// things. If episode listing or transcripts stop working, this is the file to
// poke — and the place you'd eventually swap in yt-dlp or the official Data API.
// ─────────────────────────────────────────────────────────────────────────────

let _yt: Innertube | null = null;
async function client(): Promise<Innertube> {
  if (!_yt) _yt = await Innertube.create({ retrieve_player: false });
  return _yt;
}

function parseVideoId(url: string): string | null {
  const m =
    url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/) || url.match(/\/shorts\/([\w-]{11})/);
  return m ? m[1] : null;
}

function parsePlaylistId(url: string): string | null {
  const m = url.match(/[?&]list=([\w-]+)/);
  return m ? m[1] : null;
}

/** Turn a video / playlist / channel URL into a titled show + list of episodes. */
export async function resolveEpisodes(
  url: string,
  maxEpisodes: number
): Promise<{ showTitle: string; episodes: Episode[] }> {
  const yt = await client();
  const trimmed = url.trim();

  // 1. Playlist
  const playlistId = parsePlaylistId(trimmed);
  if (playlistId) {
    const pl = await yt.getPlaylist(playlistId);
    const items = (pl.videos || []).slice(0, maxEpisodes);
    return {
      showTitle: (pl.info?.title as string) || "Playlist",
      episodes: items.map(toEpisode).filter(Boolean) as Episode[],
    };
  }

  // 2. Single video (or comma/newline separated list of videos)
  const videoIds = trimmed
    .split(/[\s,]+/)
    .map(parseVideoId)
    .filter(Boolean) as string[];
  if (videoIds.length > 0) {
    const episodes: Episode[] = [];
    for (const id of videoIds.slice(0, maxEpisodes)) {
      try {
        const info = await yt.getInfo(id);
        episodes.push({
          videoId: id,
          title: info.basic_info.title || id,
          url: `https://www.youtube.com/watch?v=${id}`,
        });
      } catch {
        episodes.push({ videoId: id, title: id, url: `https://www.youtube.com/watch?v=${id}` });
      }
    }
    return { showTitle: episodes[0]?.title || "Episodes", episodes };
  }

  // 3. Channel (@handle, /channel/UC..., /c/name, /user/name)
  if (/youtube\.com\//.test(trimmed)) {
    const resolved: any = await yt.resolveURL(trimmed);
    const browseId = resolved?.payload?.browseId;
    if (browseId) {
      const channel = await yt.getChannel(browseId);
      const videosTab: any = await channel.getVideos();
      const items = (videosTab.videos || []).slice(0, maxEpisodes);
      return {
        showTitle: (channel.metadata?.title as string) || "Channel",
        episodes: items.map(toEpisode).filter(Boolean) as Episode[],
      };
    }
  }

  throw new Error("Could not parse that URL. Paste a YouTube playlist, channel, or one-or-more video URLs.");
}

function toEpisode(item: any): Episode | null {
  const videoId = item?.id || item?.video_id;
  if (!videoId) return null;
  return {
    videoId,
    title: item?.title?.text || item?.title || videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    publishedText: item?.published?.text,
  };
}

/** Fetch the caption text for one video. Returns null if no captions exist. */
export async function fetchTranscript(videoId: string): Promise<string | null> {
  const yt = await client();
  try {
    const info = await yt.getInfo(videoId);
    const tr: any = await info.getTranscript();
    const segments = tr?.transcript?.content?.body?.initial_segments || [];
    const text = segments
      .map((s: any) => s?.snippet?.text || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 0 ? text : null;
  } catch {
    return null; // no transcript / disabled
  }
}
