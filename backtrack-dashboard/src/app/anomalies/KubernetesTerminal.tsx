"use client";
import { useEffect, useRef, useState, useCallback } from "react";

type OutputLine = {
  id: number;
  type: "input" | "output" | "error" | "info" | "divider";
  text: string;
};

let lineId = 0;

function colorClass(line: string, type: OutputLine["type"]): string {
  if (type === "error")   return "text-rose-400";
  if (type === "info")    return "text-[var(--accent-teal)] opacity-50";
  if (type === "input")   return "text-emerald-400";
  if (type === "divider") return "text-white/10";
  const l = line.toLowerCase();
  if (l.includes("running"))                           return "text-emerald-400";
  if (l.includes("error") || l.includes("crashloop")) return "text-rose-400";
  if (l.includes("pending") || l.includes("warning")) return "text-amber-400";
  if (l.startsWith("name") || l.includes("namespace")) return "text-[var(--accent-cyan)]";
  return "text-[var(--text-secondary)]";
}

export default function AnomalyTerminal({ clusterName }: { clusterName?: string }) {
  const [lines, setLines] = useState<OutputLine[]>(() => [
    { id: lineId++, type: "info", text: "─".repeat(56) },
    { id: lineId++, type: "info", text: `  BackTrack · kubectl · ${clusterName ?? "local"}` },
    { id: lineId++, type: "info", text: "─".repeat(56) },
    { id: lineId++, type: "info", text: "  Type kubectl or docker commands. Ctrl+C to cancel." },
    { id: lineId++, type: "divider", text: "" },
  ]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [running, setRunning] = useState(false);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const abortRef   = useRef<AbortController | null>(null);

  // Auto-scroll on new output
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const push = useCallback((type: OutputLine["type"], text: string) => {
    setLines(prev => [...prev, { id: lineId++, type, text }]);
  }, []);

  const execute = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    push("input", `$ ${trimmed}`);
    push("divider", "─".repeat(52));
    setHistory(h => [trimmed, ...h.filter(x => x !== trimmed)].slice(0, 50));
    setHistIdx(-1);
    setRunning(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: trimmed }),
        signal: ctrl.signal,
      });

      const data = await res.json();

      if (res.status === 403) {
        push("error", data.error ?? "Command not permitted.");
      } else {
        if (data.output) {
          for (const line of (data.output as string).split("\n")) {
            if (line.trim()) push("output", line);
          }
        }
        if (data.error?.trim()) {
          push("error", data.error.trim());
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        push("error", `Connection error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      push("divider", "─".repeat(52));
    }
  }, [push]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      execute(input);
      setInput("");
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      if (abortRef.current) {
        abortRef.current.abort();
        push("error", "^C");
      }
      setInput("");
      setHistIdx(-1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.min(i + 1, history.length - 1);
        setInput(history[next] ?? "");
        return next;
      });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHistIdx(i => {
        const next = Math.max(i - 1, -1);
        setInput(next === -1 ? "" : (history[next] ?? ""));
        return next;
      });
    }
  }, [input, execute, history, push]);

  return (
    <div className="flex flex-col h-full w-full bg-[#07090d] rounded-lg overflow-hidden">
      {/* Output area — cursor:text lets the browser show the text cursor for selection */}
      <div className="flex-1 overflow-y-auto p-3 space-y-[2px] scrollbar-hide cursor-text">
        {lines.map(line => (
          <div
            key={line.id}
            className={`bt-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap break-all select-text ${colorClass(line.text, line.type)}`}
          >
            {line.type === "divider" ? (
              <span className="text-white/[0.07]">{"─".repeat(52)}</span>
            ) : line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input row — clicking anywhere in this row focuses the input */}
      <div
        className="flex-shrink-0 flex items-center gap-2 border-t border-white/[0.06] px-3 py-2 bg-[#07090d] cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        <span className="bt-mono text-[11.5px] text-emerald-400 select-none flex-shrink-0">
          {running ? (
            <span className="text-amber-400 animate-pulse">●</span>
          ) : "$"}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="flex-1 bg-transparent bt-mono text-[11.5px] text-[var(--text-primary)] outline-none caret-[var(--accent-teal)] placeholder:text-white/20 disabled:opacity-50"
          placeholder={running ? "running…" : "kubectl get pods -n default"}
        />
      </div>
    </div>
  );
}
