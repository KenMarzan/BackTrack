"use client";
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

export default function AnomalyTerminal() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const term = new Terminal({
      theme: { background: "#161C27" },
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    term.open(ref.current);

    setTimeout(() => {
      try {
        fit.fit();
      } catch (e) {
        console.warn("Failed to fit terminal:", e);
      }
    }, 100);

    // Connect to WebSocket
    const ws = new WebSocket("ws://localhost:8080");

    ws.onopen = () => {
      term.writeln("Connected to Kubernetes cluster...");
      term.writeln("Streaming logs...\r\n");
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.writeln("\r\nWebSocket connection error");
    };

    ws.onclose = () => {
      term.writeln("\r\nDisconnected from cluster");
    };

    const handleResize = () => {
      try {
        fit.fit();
      } catch (e) {
        console.warn("Failed to fit on resize:", e);
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      ws.close();
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, []);

  return <div className="h-full w-full" ref={ref} />;
}
