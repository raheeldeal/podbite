import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// Cache layer = the cost story (summarize/transcribe once, reuse forever).
//
// Local dev → file cache under .cache/.
// Production (Vercel) → Vercel KV (Upstash Redis REST), used when KV_REST_API_URL
//   + KV_REST_API_TOKEN are set. Vercel's filesystem is ephemeral/read-only, so
//   without KV the cache degrades to a best-effort no-op (writes are swallowed,
//   everything just recomputes) — the app still works, deploy isn't blocked on KV.

const CACHE_DIR = path.join(process.cwd(), ".cache");
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const useKV = Boolean(KV_URL && KV_TOKEN);

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// ── Vercel KV (Upstash Redis REST) — single-command POST API ──────────────────
async function kvCommand(command: unknown[]): Promise<any> {
  const res = await fetch(KV_URL as string, {
    method: "POST",
    headers: { authorization: `Bearer ${KV_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`KV ${res.status}`);
  return (await res.json())?.result ?? null;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const k = hashKey(key);
  try {
    if (useKV) {
      const raw = await kvCommand(["GET", k]);
      return raw ? (JSON.parse(raw as string) as T) : null;
    }
    const raw = await fs.readFile(path.join(CACHE_DIR, `${k}.json`), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null; // miss (or backend error — treat as miss)
  }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const k = hashKey(key);
  const json = JSON.stringify(value);
  try {
    if (useKV) {
      await kvCommand(["SET", k, json]);
      return;
    }
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${k}.json`), json, "utf8");
  } catch {
    // best-effort: a read-only/ephemeral fs or KV hiccup just means no caching
  }
}

/** Stable short hash of a list of video IDs, for keying the synthesis. */
export function idsHash(ids: string[]): string {
  return crypto
    .createHash("sha256")
    .update([...ids].sort().join(","))
    .digest("hex")
    .slice(0, 12);
}
