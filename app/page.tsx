"use client";

import { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { IngestResponse, LengthPreset } from "@/lib/types";

const STAGES = [
  "Resolving episodes…",
  "Pulling captions…",
  "Reading each episode…",
  "Finding the through-line…",
  "Writing the synthesis…",
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [length, setLength] = useState<LengthPreset>("quick");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function run() {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStage(0);
    // optimistic staged messages so a 1–3 min pipeline doesn't feel frozen
    stageTimer.current = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 9000);

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, length }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      setResult(data as IngestResponse);
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      if (stageTimer.current) clearInterval(stageTimer.current);
      setLoading(false);
    }
  }

  return (
    <main className="wrap">
      <h1 className="brand">podsynth.</h1>
      <p className="tagline">Paste a podcast. Get the whole show, at the length you choose.</p>

      <textarea
        className="field"
        placeholder="YouTube playlist, channel, or one-or-more video URLs…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />

      <div className="row">
        <div className="seg" role="group" aria-label="Read length">
          <button className={length === "quick" ? "active" : ""} onClick={() => setLength("quick")}>
            Quick read
          </button>
          <button className={length === "deep" ? "active" : ""} onClick={() => setLength("deep")}>
            Deep read
          </button>
        </div>
        <button className="go" onClick={run} disabled={loading}>
          {loading ? "Synthesizing…" : "Synthesize"}
        </button>
      </div>
      <p className="hint">
        Quick ≈ a 5-minute read · Deep ≈ a 20-minute read. Most-recent {`${process.env.NEXT_PUBLIC_MAX || 10}`} episodes.
      </p>

      {loading && (
        <div className="status">
          <span className="dot" />
          {STAGES[stage]}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="result">
          <div className="meta">
            {result.showTitle} · {result.episodeCount} episodes synthesized
            {result.cached ? " · cached" : ""}
          </div>
          <ReactMarkdown>{result.synthesis}</ReactMarkdown>
          {result.skipped.length > 0 && (
            <div className="skipped">
              Skipped {result.skipped.length}: {result.skipped.map((s) => s.title).join(", ")}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
