import { Innertube } from "youtubei.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Episode } from "./types";

const execFileP = promisify(execFile);

// ── NOTE ─────────────────────────────────────────────────────────────────────
// This is the only file that talks to YouTube.
//
// Episode LISTING uses youtubei.js (scrapes YouTube's internal API). Listing
// endpoints don't need attestation, so this part is stable enough.
//
// CAPTIONS use the `yt-dlp` binary, NOT youtubei.js. As of 2025–26 YouTube
// requires a "PoToken" (a BotGuard proof-of-origin token) for caption fetches —
// without it the timedtext endpoint returns an empty 200 body and the old
// get_transcript endpoint 400s. yt-dlp solves the JS challenge itself (via deno)
// and gets real captions, so we shell out to it. This is the swap-in the README
// always anticipated. Requires `yt-dlp` and `deno` on PATH (brew install yt-dlp deno).
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

/**
 * Resolve a single episode (the "this episode" path) from a video URL.
 * Title comes from YouTube's keyless oEmbed endpoint, which works from cloud IPs
 * where youtubei.js listing is unreliable — so this path works in prod too.
 */
export async function resolveSingleEpisode(
  url: string
): Promise<{ showTitle: string; episodes: Episode[] }> {
  const videoId = parseVideoId(url.trim());
  if (!videoId)
    throw new Error("Could not find a video in that URL. Paste a YouTube episode link.");

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let title = videoId;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
    );
    if (res.ok) title = (await res.json())?.title || videoId;
  } catch {
    /* fall back to the id as title */
  }

  const ep: Episode = { videoId, title, url: watchUrl };
  return { showTitle: title, episodes: [ep] };
}

/**
 * Fetch the caption text for one video. Uses the hosted Supadata API when
 * SUPADATA_API_KEY is set (the prod path — yt-dlp can't run on Vercel and
 * YouTube blocks its IPs), otherwise the local yt-dlp path. Returns null if no
 * captions exist. See the file header.
 */
export async function fetchTranscript(videoId: string): Promise<string | null> {
  if (process.env.SUPADATA_API_KEY) return fetchTranscriptViaSupadata(videoId);
  return fetchTranscriptViaYtDlp(videoId);
}

/** Hosted caption fetch (prod). Supadata handles PoTokens + non-blocked IPs. */
async function fetchTranscriptViaSupadata(videoId: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(
      `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&lang=en`,
      { headers: { "x-api-key": process.env.SUPADATA_API_KEY as string } }
    );
    if (!res.ok) return null; // 404/no-captions or quota — treat as no captions
    const data: any = await res.json();
    // `content` is either a plain string or an array of timed segments.
    const text =
      typeof data?.content === "string"
        ? data.content
        : (data?.content || []).map((s: any) => s?.text || "").join(" ");
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > 0 ? clean : null;
  } catch {
    return null;
  }
}

/** Local caption fetch via the yt-dlp binary (see file header for why). */
async function fetchTranscriptViaYtDlp(videoId: string): Promise<string | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `podbite-${videoId}-`));
  try {
    await execFileP(
      "yt-dlp",
      [
        "--skip-download",
        "--write-subs", // human-authored captions, if any
        "--write-auto-subs", // fall back to YouTube's ASR captions
        "--sub-langs",
        "en,en-orig", // manual "en" + the original-language auto track
        "--sub-format",
        "json3",
        "-o",
        path.join(tmpDir, "%(id)s.%(ext)s"),
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }
    );

    const files = (await fs.readdir(tmpDir)).filter((f) => f.endsWith(".json3"));
    if (files.length === 0) return null;
    // Prefer the manual "<id>.en.json3" over the auto "<id>.en-orig.json3".
    const chosen = files.find((f) => /\.en\.json3$/.test(f)) || files[0];

    const data = JSON.parse(await fs.readFile(path.join(tmpDir, chosen), "utf8"));
    const text: string = (data.events || [])
      .flatMap((e: any) => (e.segs || []).map((s: any) => s.utf8 || ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 0 ? text : null;
  } catch {
    return null; // no captions / yt-dlp failure / disabled
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
