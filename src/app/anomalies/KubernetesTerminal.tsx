"use client";
import { useEffect, useRef } from "react";

export default function AnomalyTerminal() {
  const ref = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<any>(null);

  useEffect(() => {
    if (!ref.current) return;

    let disposed = false;

    const initTerminal = async () => {
      if (typeof window === "undefined") return;

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("xterm"),
        import("xterm-addon-fit"),
      ]);
      await import("xterm/css/xterm.css");

      if (disposed || !ref.current) return;

      const term = new Terminal({
        theme: {
          background: "#161C27",
          foreground: "#E0E0E0",
          cursor: "#00FF00",
        },
        fontSize: 13,
        fontFamily: 'Monaco, Menlo, "Courier New", monospace',
        cursorBlink: true,
        cursorStyle: "block",
        lineHeight: 1.5,
        cols: 120,
        rows: 30,
        scrollback: 1000,
      });
      termRef.current = term;

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(ref.current);

      if (term.element) {
        term.element.style.overflow = "hidden";
      }

      setTimeout(() => {
        try {
          fit.fit();
        } catch (e) {
          console.warn("Failed to fit terminal:", e);
        }
      }, 100);

      // Beautiful header
      term.writeln(
        "\x1b[36m╔════════════════════════════════════════════════════════════╗\x1b[0m",
      );
      term.writeln(
        "\x1b[36m║           Kubernetes Cluster Terminal                      ║\x1b[0m",
      );
      term.writeln(
        "\x1b[36m╚════════════════════════════════════════════════════════════╝\x1b[0m",
      );
      term.writeln("");
      term.writeln(
        "\x1b[33mType kubectl commands (e.g., 'kubectl get pods')\x1b[0m",
      );
      term.writeln("");

      let currentCommand = "";

      // Handle user input
      term.onData((data) => {
        if (data === "\r") {
          // Enter key - execute command
          term.writeln("");

          if (currentCommand.trim()) {
            executeCommand(currentCommand);
          }

          currentCommand = "";
          term.write("\x1b[32m$\x1b[0m ");
        } else if (data === "\u007F") {
          // Backspace
          if (currentCommand.length > 0) {
            currentCommand = currentCommand.slice(0, -1);
            term.write("\b \b");
          }
        } else if (data === "\u0003") {
          // Ctrl+C
          currentCommand = "";
          term.writeln("^C");
          term.write("\x1b[32m$\x1b[0m ");
        } else {
          // Regular character
          currentCommand += data;
          term.write(data);
        }
      });

      const executeCommand = async (command: string) => {
        term.writeln("\x1b[90m" + "─".repeat(60) + "\x1b[0m");

        try {
          const response = await fetch("/api/terminal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command }),
          });

          const result = await response.json();

          if (result.output) {
            // Parse and format output
            const lines = result.output.split("\n");
            lines.forEach((line: string) => {
              if (line.includes("Running")) {
                term.writeln("\x1b[32m" + line + "\x1b[0m"); // Green for Running
              } else if (
                line.includes("Error") ||
                line.includes("CrashLoopBackOff")
              ) {
                term.writeln("\x1b[31m" + line + "\x1b[0m"); // Red for errors
              } else if (line.includes("Pending")) {
                term.writeln("\x1b[33m" + line + "\x1b[0m"); // Yellow for Pending
              } else if (line.includes("NAME") || line.includes("NAMESPACE")) {
                term.writeln("\x1b[36m" + line + "\x1b[0m"); // Cyan for headers
              } else {
                term.writeln(line);
              }
            });
          }

          if (result.error && result.error.trim()) {
            term.writeln("\x1b[31mError: " + result.error + "\x1b[0m");
          }

          term.writeln("\x1b[90m" + "─".repeat(60) + "\x1b[0m");
          term.write("\x1b[32m$\x1b[0m ");
        } catch (error: any) {
          term.writeln(
            "\x1b[31mConnection error: " + error.message + "\x1b[0m",
          );
          term.write("\x1b[32m$\x1b[0m ");
        }
      };

      term.write("\x1b[32m$\x1b[0m ");

      const handleResize = () => {
        try {
          fit.fit();
        } catch (e) {
          console.warn("Failed to fit on resize:", e);
        }
      };
      window.addEventListener("resize", handleResize);

      return () => {
        window.removeEventListener("resize", handleResize);
        term.dispose();
      };
    };

    const cleanupPromise = initTerminal();

    return () => {
      disposed = true;
      void cleanupPromise;
      if (termRef.current) {
        try {
          termRef.current.dispose();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return <div className="h-full w-full" ref={ref} />;
}
