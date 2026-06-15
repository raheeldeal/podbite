import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".cache");

function keyToPath(key: string): string {
  // hash the key so arbitrary strings become safe filenames
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return path.join(CACHE_DIR, `${hash}.json`);
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(keyToPath(key), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null; // miss
  }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(keyToPath(key), JSON.stringify(value), "utf8");
}

/** Stable short hash of a list of video IDs, for keying the synthesis. */
export function idsHash(ids: string[]): string {
  return crypto
    .createHash("sha256")
    .update([...ids].sort().join(","))
    .digest("hex")
    .slice(0, 12);
}
