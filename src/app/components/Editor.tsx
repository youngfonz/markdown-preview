"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

const DEFAULT_CONTENT = `# Welcome to Pulse Markdown

A fast, clean markdown editor with **live preview**.

## Features

- **Real-time preview** as you type
- GitHub Flavored Markdown (tables, checklists, strikethrough)
- Clean, distraction-free interface
- **Tabs** — open multiple files side by side
- **Read aloud** with OpenAI's Nova voice

## Try it out

Edit the left pane and watch the preview update instantly.

> Built with care by **Pulse Pro**
`;

type Tab = {
  id: string;
  content: string;
  fileName?: string;
};

type FileHandleLike = {
  name: string;
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
  getFile: () => Promise<File>;
};

declare global {
  interface Window {
    showOpenFilePicker?: (opts?: {
      multiple?: boolean;
      types?: { description?: string; accept?: Record<string, string[]> }[];
    }) => Promise<FileHandleLike[]>;
    showSaveFilePicker?: (opts?: {
      suggestedName?: string;
      types?: { description?: string; accept?: Record<string, string[]> }[];
    }) => Promise<FileHandleLike>;
  }
}

const MD_TYPES = [
  {
    description: "Markdown",
    accept: { "text/markdown": [".md", ".markdown", ".mdx"] as string[] },
  },
];

const STORAGE_KEY = "pulse-md-tabs-v1";
const OPENAI_KEY_STORAGE = "pulse-md-openai-key-v1";
const TTS_VOICE = "nova"; // Warm female — OpenAI's most natural-sounding voice

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function deriveName(content: string, fileName?: string): string {
  if (fileName) return fileName.replace(/\.(md|markdown|mdx)$/i, "");
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 32);
  const firstLine = content.trim().split("\n")[0]?.trim();
  if (firstLine) return firstLine.slice(0, 32);
  return "Untitled";
}

function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^[ \t]*[#>]+[ \t]*/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*\d+\.[ \t]+/gm, "")
    .replace(/^[ \t]*\|.*\|[ \t]*$/gm, " ")
    .replace(/^[ \t]*[-=:]{3,}[ \t]*$/gm, " ")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim();
}

function chunkText(text: string, maxLen = 3500): string[] {
  if (!text) return [];
  const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if ((current + " " + piece).trim().length > maxLen && current) {
      chunks.push(current.trim());
      current = piece;
    } else {
      current = (current + " " + piece).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export default function Editor() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "default", content: DEFAULT_CONTENT },
  ]);
  const [activeId, setActiveId] = useState<string>("default");
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [splitPercent, setSplitPercent] = useState(50);
  const [ttsState, setTtsState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [fetchStatus, setFetchStatus] = useState<string>("");
  const [openaiKey, setOpenaiKey] = useState<string>("");
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopSignalRef = useRef<(() => void) | null>(null);
  const speakingRef = useRef<boolean>(false);
  const activeFetchCtrlRef = useRef<AbortController | null>(null);
  const fileHandlesRef = useRef<Map<string, FileHandleLike>>(new Map());
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { tabs: Tab[]; activeId: string };
        if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          setTabs(parsed.tabs);
          const exists = parsed.tabs.find((t) => t.id === parsed.activeId);
          setActiveId(exists?.id ?? parsed.tabs[0].id);
        }
      }
      const k = localStorage.getItem(OPENAI_KEY_STORAGE);
      if (k) setOpenaiKey(k);
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
    } catch {}
  }, [tabs, activeId, hydrated]);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const content = activeTab?.content ?? "";

  const updateContent = useCallback(
    (next: string) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === activeId ? { ...t, content: next } : t))
      );
    },
    [activeId]
  );

  const addTab = useCallback(() => {
    const id = newId();
    setTabs((prev) => [...prev, { id, content: "" }]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length === 1) {
          const fresh = { id: newId(), content: "" };
          setActiveId(fresh.id);
          return [fresh];
        }
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        if (id === activeId) {
          const fallback = next[Math.max(0, idx - 1)] ?? next[0];
          setActiveId(fallback.id);
        }
        return next;
      });
    },
    [activeId]
  );

  const speak = useCallback(async () => {
    const stripped = stripMarkdown(content);
    if (!stripped) return;

    speakingRef.current = true;
    setTtsState("loading");

    const chunks = chunkText(stripped, 3500);
    console.log(`[TTS] split into ${chunks.length} chunks`);

    const FETCH_TIMEOUT_MS = 20000;
    const fetchChunk = async (text: string, chunkNum: number): Promise<Blob | null> => {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!speakingRef.current) return null;
        setFetchStatus(
          attempt === 1
            ? `chunk ${chunkNum}…`
            : `chunk ${chunkNum} retry ${attempt}/${maxAttempts}…`
        );
        const ctrl = new AbortController();
        activeFetchCtrlRef.current = ctrl;
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
          const resp = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              voice: TTS_VOICE,
              speed: 0.92, // slightly slower than default for a more natural cadence
              apiKey: openaiKey || undefined,
            }),
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (resp.ok) return await resp.blob();

          // Auth / quota errors — don't retry, surface immediately
          if (resp.status === 400 || resp.status === 401 || resp.status === 429) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            console.error("[TTS] OpenAI error:", err);
            const errMsg = err.error ?? resp.statusText;
            if (resp.status === 400 && /api key/i.test(String(errMsg))) {
              setShowSettings(true);
            } else if (/insufficient_quota/i.test(String(errMsg))) {
              alert(
                "OpenAI says: insufficient quota.\n\n" +
                "Even with credits added, this can mean:\n" +
                "• The credit hasn't propagated yet (wait 2–5 min)\n" +
                "• Your account needs phone verification\n" +
                "• You're using an old key from before adding credit\n\n" +
                "Check platform.openai.com/account/billing/overview to confirm your credit balance."
              );
            } else {
              alert(`OpenAI error: ${errMsg}`);
            }
            return null;
          }

          // 5xx — transient server hiccup, retry with backoff
          console.warn(`[TTS] OpenAI ${resp.status} on attempt ${attempt}/${maxAttempts}, retrying…`);
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
            continue;
          }
          const err = await resp.json().catch(() => ({ error: resp.statusText }));
          alert(`OpenAI server error after ${maxAttempts} retries.\n\n${err.error ?? resp.statusText}\n\nOpenAI TTS may be having an outage — check status.openai.com.`);
          return null;
        } catch (e) {
          clearTimeout(timer);
          // If the user clicked Stop, exit immediately — don't retry.
          if (!speakingRef.current) return null;
          const aborted = e instanceof DOMException && e.name === "AbortError";
          console.warn(
            `[TTS] ${aborted ? "timed out" : "fetch failed"} on attempt ${attempt}/${maxAttempts}:`,
            e
          );
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
            continue;
          }
          alert(
            aborted
              ? `OpenAI took longer than ${FETCH_TIMEOUT_MS / 1000}s to respond after ${maxAttempts} tries.\nTheir TTS endpoint may be having an outage — check status.openai.com.`
              : "Network error talking to OpenAI. Check your connection."
          );
          return null;
        } finally {
          if (activeFetchCtrlRef.current === ctrl) activeFetchCtrlRef.current = null;
        }
      }
      return null;
    };

    try {
      // Pipeline: fetch chunk N+1 while chunk N is playing
      let nextPromise: Promise<Blob | null> = fetchChunk(chunks[0], 1);
      for (let i = 0; i < chunks.length; i++) {
        if (!speakingRef.current) return;
        const blob = await nextPromise;
        if (i + 1 < chunks.length) nextPromise = fetchChunk(chunks[i + 1], i + 2);
        if (!blob) return;
        if (!speakingRef.current) return;

        if (i === 0) setTtsState("playing");

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        try {
          await audio.play();
        } catch (err) {
          URL.revokeObjectURL(url);
          if (!speakingRef.current) return;
          const name = err instanceof Error ? err.name : "";
          if (name === "AbortError") return;
          console.error("[TTS] audio.play() failed:", err);
          alert("Audio is blocked by the browser. Click anywhere on the page and press Read again.");
          return;
        }

        await new Promise<void>((resolve) => {
          stopSignalRef.current = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onended = () => {
            URL.revokeObjectURL(url);
            stopSignalRef.current = null;
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            stopSignalRef.current = null;
            resolve();
          };
        });
      }
    } finally {
      speakingRef.current = false;
      audioRef.current = null;
      setFetchStatus("");
      setTtsState("idle");
    }
  }, [content, openaiKey]);

  const pauseSpeak = useCallback(() => {
    if (audioRef.current && !audioRef.current.paused) audioRef.current.pause();
    setTtsState("paused");
  }, []);

  const resumeSpeak = useCallback(() => {
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().catch(() => {});
    }
    setTtsState("playing");
  }, []);

  const stopSpeak = useCallback(() => {
    speakingRef.current = false;
    if (activeFetchCtrlRef.current) {
      activeFetchCtrlRef.current.abort();
      activeFetchCtrlRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (stopSignalRef.current) {
      stopSignalRef.current();
      stopSignalRef.current = null;
    }
    setFetchStatus("");
    setTtsState("idle");
  }, []);

  useEffect(() => {
    speakingRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (stopSignalRef.current) {
      stopSignalRef.current();
      stopSignalRef.current = null;
    }
    setTtsState("idle");
  }, [activeId]);

  const addTabWithFile = useCallback(
    async (file: File, handle?: FileHandleLike) => {
      const text = await file.text();
      const id = newId();
      setTabs((prev) => [
        ...prev,
        { id, content: text, fileName: file.name },
      ]);
      setActiveId(id);
      if (handle) fileHandlesRef.current.set(id, handle);
    },
    []
  );

  const handleOpen = useCallback(async () => {
    if (typeof window === "undefined" || !window.showOpenFilePicker) {
      // Fallback: invisible <input type="file"> trigger
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".md,.markdown,.mdx,text/markdown,text/plain";
      input.multiple = true;
      input.onchange = async () => {
        for (const f of Array.from(input.files ?? [])) await addTabWithFile(f);
      };
      input.click();
      return;
    }
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: MD_TYPES,
      });
      for (const h of handles) {
        const file = await h.getFile();
        await addTabWithFile(file, h);
      }
    } catch (e) {
      // User cancelled — DOMException AbortError
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("[open] failed:", e);
    }
  }, [addTabWithFile]);

  const handleSave = useCallback(async () => {
    if (!activeTab) return;
    const existing = fileHandlesRef.current.get(activeTab.id);
    try {
      if (existing) {
        const writable = await existing.createWritable();
        await writable.write(activeTab.content);
        await writable.close();
      } else if (typeof window !== "undefined" && window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName:
            activeTab.fileName ?? `${deriveName(activeTab.content)}.md`,
          types: MD_TYPES,
        });
        const writable = await handle.createWritable();
        await writable.write(activeTab.content);
        await writable.close();
        fileHandlesRef.current.set(activeTab.id, handle);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTab.id ? { ...t, fileName: handle.name } : t
          )
        );
      } else {
        // Last-resort fallback: download via <a>
        const blob = new Blob([activeTab.content], {
          type: "text/markdown;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download =
          activeTab.fileName ?? `${deriveName(activeTab.content)}.md`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("[save] failed:", e);
      alert("Save failed. See console for details.");
    }
  }, [activeTab]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "t" || e.code === "KeyT") {
        e.preventDefault();
        addTab();
      } else if (key === "w" || e.code === "KeyW") {
        e.preventDefault();
        closeTab(activeId);
      } else if (key === "o" || e.code === "KeyO") {
        e.preventDefault();
        handleOpen();
      } else if (key === "s" || e.code === "KeyS") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addTab, closeTab, activeId, handleOpen, handleSave]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const items = e.dataTransfer.items;
      if (window.showOpenFilePicker && items?.length) {
        for (const item of Array.from(items)) {
          if (item.kind !== "file") continue;
          const getAsHandle = (
            item as DataTransferItem & {
              getAsFileSystemHandle?: () => Promise<FileHandleLike | null>;
            }
          ).getAsFileSystemHandle;
          const handle = getAsHandle ? await getAsHandle.call(item) : null;
          const file = item.getAsFile();
          if (file) await addTabWithFile(file, handle ?? undefined);
        }
        return;
      }
      for (const f of Array.from(e.dataTransfer.files ?? [])) {
        await addTabWithFile(f);
      }
    },
    [addTabWithFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types?.includes("Files")) e.preventDefault();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.min(80, Math.max(20, pct)));
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handleClear = useCallback(() => {
    updateContent("");
  }, [updateContent]);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  const renderedMarkdown = useMemo(
    () => (
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {content}
      </ReactMarkdown>
    ),
    [content]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-white text-sm" style={{ background: "var(--accent)" }}>
            P
          </div>
          <span className="font-semibold text-sm tracking-tight">Pulse Markdown</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs mr-2" style={{ color: "var(--text-secondary)" }}>
            {wordCount} words / {charCount} chars
          </span>
          <button
            onClick={handleOpen}
            className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            title="Open .md file (⌘⌥O)"
          >
            Open
          </button>
          <button
            onClick={handleSave}
            disabled={!content.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            title="Save (⌘⌥S)"
          >
            {savedFlash ? "Saved!" : "Save"}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            title="TTS settings"
            aria-label="Settings"
          >
            ⚙
          </button>
          {ttsState === "idle" && (
            <button
              onClick={speak}
              disabled={!content.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              title="Read aloud (OpenAI Nova)"
            >
              ▶ Read
            </button>
          )}
          {ttsState === "loading" && (
            <button
              onClick={stopSpeak}
              className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              title="Click to cancel"
            >
              {fetchStatus ? `Fetching ${fetchStatus}` : "Fetching audio…"}
            </button>
          )}
          {ttsState === "playing" && (
            <>
              <button
                onClick={pauseSpeak}
                className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                ⏸ Pause
              </button>
              <button
                onClick={stopSpeak}
                className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                ⏹ Stop
              </button>
            </>
          )}
          {ttsState === "paused" && (
            <>
              <button
                onClick={resumeSpeak}
                className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                ▶ Resume
              </button>
              <button
                onClick={stopSpeak}
                className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                ⏹ Stop
              </button>
            </>
          )}
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            {copied ? "Copied!" : "Copy MD"}
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Clear
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div
        className="flex items-stretch border-b"
        style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}
      >
        <div className="flex flex-1 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.id === activeId;
            const name = deriveName(tab.content, tab.fileName);
            return (
              <div
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    closeTab(tab.id);
                  }
                }}
                className="group flex items-center gap-2 pl-3 pr-2 py-2 text-xs cursor-pointer border-r select-none"
                style={{
                  borderColor: "var(--border)",
                  background: isActive ? "var(--bg)" : "transparent",
                  color: isActive ? "var(--text)" : "var(--text-secondary)",
                  borderTop: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                  marginTop: "-1px",
                }}
                title={name}
              >
                <span className="truncate max-w-[180px]">{name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 opacity-50 group-hover:opacity-100 transition-opacity"
                  aria-label={`Close ${name}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={addTab}
          className="px-3 py-2 text-base hover:opacity-80 border-l"
          style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
          aria-label="New tab"
          title="New tab"
        >
          +
        </button>
      </div>

      {/* Settings dialog */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="w-[480px] max-w-[90vw] rounded-lg p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">OpenAI TTS settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="text-xl leading-none opacity-60 hover:opacity-100"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
              Read uses OpenAI Nova (~$0.03 per 1,000 characters). Get a key at{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="underline"
                style={{ color: "var(--accent)" }}
              >
                platform.openai.com/api-keys
              </a>
              . Stored only in your browser&apos;s localStorage; never logged or committed.
            </p>
            <label className="text-xs font-medium block mb-1">OpenAI API key</label>
            <input
              type="password"
              value={openaiKey}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 text-sm rounded-md border bg-transparent font-mono"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
              spellCheck={false}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  setOpenaiKey("");
                  try {
                    localStorage.removeItem(OPENAI_KEY_STORAGE);
                  } catch {}
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-md border hover:opacity-80"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                Clear
              </button>
              <button
                onClick={() => {
                  try {
                    if (openaiKey) localStorage.setItem(OPENAI_KEY_STORAGE, openaiKey);
                  } catch {}
                  setShowSettings(false);
                }}
                className="px-4 py-1.5 text-xs font-semibold rounded-md text-white hover:opacity-90"
                style={{ background: "var(--accent)" }}
              >
                Save
              </button>
            </div>
            <p className="text-[10px] mt-4 opacity-60">
              Alternative: set <code className="font-mono">OPENAI_API_KEY</code> in{" "}
              <code className="font-mono">.env.local</code> and restart the dev server.
              Server-side keys never reach the browser.
            </p>
          </div>
        </div>
      )}

      {/* Split pane */}
      <div ref={containerRef} className="flex flex-1 min-h-0">
        {/* Editor */}
        <div
          className="flex flex-col min-w-0"
          style={{ width: `${splitPercent}%` }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <div className="px-4 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-secondary)", background: "var(--bg-secondary)" }}>
            Markdown
          </div>
          <textarea
            className="editor-textarea flex-1 w-full p-4"
            value={content}
            onChange={(e) => updateContent(e.target.value)}
            placeholder="Start writing markdown... or drag a .md file here"
            spellCheck={false}
          />
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={handleMouseDown}
          className="divider-handle"
        >
          <div className="divider-grip" />
        </div>

        {/* Preview */}
        <div className="flex flex-col min-w-0" style={{ width: `${100 - splitPercent}%` }}>
          <div className="px-4 py-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-secondary)", background: "var(--bg-secondary)" }}>
            Preview
          </div>
          <div className="flex-1 overflow-auto p-6">
            <div className="preview-content max-w-none">{renderedMarkdown}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
