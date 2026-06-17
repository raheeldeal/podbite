// Text-to-speech via OpenAI's audio API. Raw fetch (matches lib/anthropic.ts):
// tiny deps, no SDK drift. Output is mp3, cached so a re-listen is free.

import { cacheGet, cacheSet } from "./cache";

const API_URL = "https://api.openai.com/v1/audio/speech";
const MODEL = "tts-1"; // cheapest good-quality voice ($15/1M chars)
const DEFAULT_VOICE = "nova";
const TTS_VERSION = "v1"; // bump to invalidate cached audio
// OpenAI caps `input` at 4096 chars/request; stay safely under and stitch chunks.
const CHUNK_CHARS = 3500;

// Strip Markdown so the voice doesn't read "#" / "*" / link syntax aloud.
function toPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // code fences
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1") // links/images → text
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/(\*\*|__|\*|_|~~)/g, "") // bold/italic/strike
    .replace(/^\s*[-*+]\s+/gm, "") // bullet markers
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Split into <= CHUNK_CHARS pieces, preferring paragraph then sentence breaks.
function chunk(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const para of text.split(/\n\n+/)) {
    if (para.length > CHUNK_CHARS) {
      flush();
      for (const sentence of para.match(/[^.!?]+[.!?]*\s*/g) || [para]) {
        if (buf.length + sentence.length > CHUNK_CHARS) flush();
        buf += sentence;
      }
      flush();
    } else {
      if (buf.length + para.length + 2 > CHUNK_CHARS) flush();
      buf += (buf ? "\n\n" : "") + para;
    }
  }
  flush();
  return out;
}

async function synthChunk(input: string, voice: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set. Add it to .env.local to enable listen.");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, voice, input, response_format: "mp3" }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Render text (Markdown ok) to an mp3, returned base64-encoded. Cached by a
 * stable key so repeat listens of the same summary cost nothing.
 */
export async function synthesizeSpeech(
  cacheId: string,
  markdown: string,
  voice: string = DEFAULT_VOICE
): Promise<string> {
  const cacheKey = `tts:${TTS_VERSION}:${MODEL}:${voice}:${cacheId}`;
  const hit = await cacheGet<string>(cacheKey);
  if (hit) return hit;

  const chunks = chunk(toPlainText(markdown));
  const buffers: Buffer[] = [];
  for (const c of chunks) buffers.push(await synthChunk(c, voice)); // sequential = no rate-limit spikes
  const base64 = Buffer.concat(buffers).toString("base64");

  await cacheSet(cacheKey, base64);
  return base64;
}
