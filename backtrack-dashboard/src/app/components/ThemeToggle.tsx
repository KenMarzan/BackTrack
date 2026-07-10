"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="h-8 w-8 rounded-full border border-[var(--border-soft)] bg-[var(--surface-glass)] hover:bg-[var(--surface-glass-hover)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent-teal)] transition"
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
