"use client";

import { useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { IngestResponse, LengthPreset } from "@/lib/types";

const STAGES = [
  "Fetching the video…",
  "Pulling captions…",
  "Reading it through…",
  "Writing your summary…",
];

const LENGTHS: { id: LengthPreset; label: string }[] = [
  { id: "quick", label: "Quick" },
  { id: "standard", label: "Standard" },
  { id: "deep", label: "Deep" },
];

type ResultsByLength = Partial<Record<LengthPreset, IngestResponse>>;
type Tab = "summary" | "transcript";

export default function Home() {
  const [url, setUrl] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState("");
  const [length, setLength] = useState<LengthPreset>("standard");
  const [results, setResults] = useState<ResultsByLength>({});
  const [loading, setLoading] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<LengthPreset | null>(null);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [copied, setCopied] = useState(false);

  // TTS (per displayed summary)
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);

  // Ask
  const [question, setQuestion] = useState("");
  const [qa, setQa] = useState<{ q: string; a: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const result = results[length] ?? null;
  const currentText = result ? (tab === "summary" ? result.synthesis : result.transcript ?? "") : "";

  async function fetchSummary(theUrl: string, len: LengthPreset): Promise<IngestResponse> {
    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: theUrl, length: len, scope: "episode" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data as IngestResponse;
  }

  async function summarize() {
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResults({});
    setQa([]);
    setAudioUrl(null);
    setTtsError(null);
    setTab("summary");
    setLength("standard");
    setSubmittedUrl(url);
    setStage(0);
    stageTimer.current = setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      9000
    );
    try {
      const data = await fetchSummary(url, "standard");
      setResults({ standard: data });
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      if (stageTimer.current) clearInterval(stageTimer.current);
      setLoading(false);
    }
  }

  async function switchLength(len: LengthPreset) {
    if (len === length && results[len]) return;
    setAudioUrl(null); // audio was for the previous length
    if (results[len]) {
      setLength(len);
      return;
    }
    setSwitchingTo(len);
    setError(null);
    try {
      const data = await fetchSummary(submittedUrl, len);
      setResults((prev) => ({ ...prev, [len]: data }));
      setLength(len);
    } catch (e: any) {
      setError(e?.message || "Couldn't load that length.");
    } finally {
      setSwitchingTo(null);
    }
  }

  async function listen() {
    if (!result || ttsLoading) return;
    setTtsLoading(true);
    setTtsError(null);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: result.synthesis }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Couldn't generate audio.");
      }
      setAudioUrl(URL.createObjectURL(await res.blob()));
    } catch (e: any) {
      setTtsError(e?.message || "Couldn't generate audio.");
    } finally {
      setTtsLoading(false);
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || asking || !submittedUrl) return;
    setAsking(true);
    setAskError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: submittedUrl, question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't answer that.");
      setQa((prev) => [...prev, { q, a: data.answer }]);
      setQuestion("");
    } catch (e: any) {
      setAskError(e?.message || "Couldn't answer that.");
    } finally {
      setAsking(false);
    }
  }

  function copyCurrent() {
    if (!currentText) return;
    navigator.clipboard?.writeText(currentText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadTxt() {
    if (!currentText || !result) return;
    const safe = (result.showTitle || "podbite").replace(/[^\w\s-]/g, "").slice(0, 60).trim();
    const blob = new Blob([currentText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safe} — ${tab}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <main className="wrap">
      <div className="brand">
        <span className="brand-icon" aria-hidden="true">
          P<span className="brand-dot">.</span>
        </span>
        <span className="brand-text">
          podbite<span className="brand-dot">.</span>
        </span>
      </div>
      <p className="tagline">Summarize. Listen. Ask.</p>
      <p className="lede">
        Paste any YouTube video — get a clean summary at the length you want, <em>listen</em> to it,
        ask it questions, and read the full transcript.
      </p>

      <input
        className="field"
        placeholder="https://youtube.com/watch?v=…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && summarize()}
      />

      <div className="row">
        <button className="go" onClick={summarize} disabled={loading}>
          {loading ? "Summarizing…" : (<>Summarize <span className="arrow">→</span></>)}
        </button>
      </div>

      {loading && (
        <div className="status">
          <span className="dot" />
          {STAGES[stage]}
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="result">
          <div className="result-head">
            <div className="meta">
              {result.showTitle}
              {result.cached ? " · cached" : ""}
            </div>
            <div className="exports">
              <button className="export" onClick={copyCurrent}>
                {copied ? "Copied ✓" : "⎘ Copy"}
              </button>
              <button className="export" onClick={downloadTxt}>↓ .txt</button>
            </div>
          </div>

          <div className="tabs" role="tablist">
            <button
              className={tab === "summary" ? "tab active" : "tab"}
              onClick={() => setTab("summary")}
            >
              Summary
            </button>
            {result.transcript && (
              <button
                className={tab === "transcript" ? "tab active" : "tab"}
                onClick={() => setTab("transcript")}
              >
                Transcript
              </button>
            )}
          </div>

          {tab === "summary" && (
            <>
              <div className="lengthbar" role="group" aria-label="Summary length">
                <div className="seg">
                  {LENGTHS.map((l) => (
                    <button
                      key={l.id}
                      className={length === l.id ? "active" : ""}
                      onClick={() => switchLength(l.id)}
                      disabled={switchingTo !== null}
                    >
                      {l.label}
                      {switchingTo === l.id ? " …" : ""}
                    </button>
                  ))}
                </div>
              </div>

              <div className="listen-row">
                {audioUrl ? (
                  <audio className="player" controls autoPlay src={audioUrl} />
                ) : (
                  <button className="listen" onClick={listen} disabled={ttsLoading}>
                    {ttsLoading ? "Generating audio…" : "▶ Listen"}
                  </button>
                )}
                {ttsError && <span className="tts-error">{ttsError}</span>}
              </div>

              <ReactMarkdown>{result.synthesis}</ReactMarkdown>
            </>
          )}

          {tab === "transcript" && result.transcript && (
            <p className="transcript-text">{result.transcript}</p>
          )}

          {/* Ask — always present */}
          <div className="ask">
            <p className="eyebrow">Ask about this video</p>
            {qa.map((item, i) => (
              <div className="qa" key={i}>
                <div className="qa-q">{item.q}</div>
                <div className="qa-a">
                  <ReactMarkdown>{item.a}</ReactMarkdown>
                </div>
              </div>
            ))}
            <div className="ask-row">
              <input
                className="ask-input"
                placeholder="e.g. What did they say about pricing?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                disabled={asking}
              />
              <button className="listen" onClick={ask} disabled={asking || !question.trim()}>
                {asking ? "Thinking…" : "Ask"}
              </button>
            </div>
            {askError && <span className="tts-error">{askError}</span>}
          </div>
        </div>
      )}
    </main>
  );
}
