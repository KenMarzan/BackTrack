"use client";
import { useEffect, useRef } from "react";

interface KubernetesTerminalProps {
  service?: string;
}

export default function AnomalyTerminal({ service }: KubernetesTerminalProps) {
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
        fontSize: 14,
        fontFamily: 'Monaco, Menlo, "Courier New", monospace',
        cursorBlink: true,
        cursorStyle: "block",
        lineHeight: 1.2,
        scrollback: 5000,
      });
      termRef.current = term;

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(ref.current);

      if (term.element) {
        term.element.style.overflow = "hidden";
        term.element.style.width = "100%";
        term.element.style.height = "100%";
        term.element.style.display = "flex";
        term.element.style.justifyContent = "center";
        term.element.style.alignItems = "flex-start";
      }

      setTimeout(() => {
        try {
          fit.fit();
        } catch (e) {
          console.warn("Failed to fit terminal:", e);
        }
      }, 100);

      // Fit again after a longer delay to ensure proper sizing
      setTimeout(() => {
        try {
          fit.fit();
        } catch (e) {
          console.warn("Failed to fit terminal on second attempt:", e);
        }
      }, 500);

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

      // Classify severity of log line
      const getSeverityColor = (line: string): string => {
        const lowerLine = line.toLowerCase();

        // CRITICAL - Bright Red
        if (
          lowerLine.includes("fatal") ||
          lowerLine.includes("critical") ||
          lowerLine.includes("panic") ||
          lowerLine.includes("crash") ||
          lowerLine.includes("exception") ||
          line.includes("CrashLoopBackOff") ||
          lowerLine.includes("segmentation fault") ||
          lowerLine.includes("out of memory")
        ) {
          return "\x1b[91m"; // Bright red for critical
        }

        // HIGH/MEDIUM - Orange/Red
        if (
          lowerLine.includes("error") ||
          lowerLine.includes("failed") ||
          lowerLine.includes("failure") ||
          lowerLine.includes("denied") ||
          lowerLine.includes("timeout") ||
          lowerLine.includes("connection refused")
        ) {
          return "\x1b[31m"; // Red for high errors
        }

        // LOW - Yellow
        if (
          lowerLine.includes("warning") ||
          lowerLine.includes("warn") ||
          lowerLine.includes("deprecated") ||
          line.includes("Pending")
        ) {
          return "\x1b[33m"; // Yellow for low priority
        }

        // INFO/SUCCESS - Green/Cyan
        if (
          lowerLine.includes("success") ||
          lowerLine.includes("completed") ||
          line.includes("Running")
        ) {
          return "\x1b[32m"; // Green
        }

        if (line.includes("NAME") || line.includes("NAMESPACE")) {
          return "\x1b[36m"; // Cyan for headers
        }

        return "\x1b[37m"; // White/default
      };

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
            // Parse and format output with severity-based colors
            const lines = result.output.split("\n");
            lines.forEach((line: string) => {
              const color = getSeverityColor(line);
              term.writeln(color + line + "\x1b[0m");
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

      // Auto-execute logs command if service is provided
      if (service) {
        let logInterval: NodeJS.Timeout;

        const fetchContinuousLogs = async () => {
          try {
            const logsCommand = `kubectl logs -l app=${service} --tail=20 --since=30s`;
            const response = await fetch("/api/terminal", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ command: logsCommand }),
            });

            const result = await response.json();

            if (result.output && result.output.trim()) {
              term.writeln("\x1b[90m" + "─".repeat(60) + "\x1b[0m");
              term.writeln(
                `\x1b[36m[${new Date().toLocaleTimeString()}] Logs from ${service}\x1b[0m`,
              );

              const lines = result.output.split("\n");
              lines.forEach((line: string) => {
                if (!line.trim()) return;
                const color = getSeverityColor(line);
                term.writeln(color + line + "\x1b[0m");
              });
            }
          } catch (error) {
            console.error("Failed to fetch logs:", error);
          }
        };

        // Initial fetch
        setTimeout(() => {
          term.writeln(
            `\x1b[33mStarting continuous log monitoring for ${service}...\x1b[0m`,
          );
          term.writeln(
            `\x1b[90mPress Ctrl+C to stop monitoring and enter commands\x1b[0m`,
          );
          term.writeln("");
          fetchContinuousLogs();
        }, 500);

        // Fetch logs every 5 seconds
        logInterval = setInterval(fetchContinuousLogs, 5000);

        // Store interval reference for cleanup
        (term as any)._logInterval = logInterval;
      }

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
          // Clear log interval if exists
          if ((termRef.current as any)._logInterval) {
            clearInterval((termRef.current as any)._logInterval);
          }
          termRef.current.dispose();
        } catch {
          // ignore
        }
      }
    };
  }, [service]);

  return (
    <div className="h-full w-full flex items-start justify-center" ref={ref} />
  );
}
