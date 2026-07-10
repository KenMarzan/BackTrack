"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string };

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  variant?: "pill" | "input";
  placeholder?: string;
};

export default function CustomSelect({
  value,
  options,
  onChange,
  className = "",
  variant = "input",
  placeholder,
}: Props) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    if (buttonRef.current) setRect(buttonRef.current.getBoundingClientRect());
    const onDoc = (e: MouseEvent) => {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScroll = () => {
      if (buttonRef.current) setRect(buttonRef.current.getBoundingClientRect());
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const triggerBase =
    variant === "pill"
      ? "rounded-full border border-[var(--border-soft)] bg-[var(--surface-muted)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:border-[var(--border-mid)]"
      : "w-full rounded-lg border border-[var(--border-mid)] bg-[var(--bg-panel-2)] px-3 py-2 text-[13px] text-[var(--text-primary)] hover:border-[var(--border-strong)]";

  const dropdown = rect && open && mounted ? createPortal(
    <ul
      ref={ref}
      role="listbox"
      style={{
        position: "fixed",
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 160),
        zIndex: 99999,
      }}
      className="overflow-hidden rounded-lg border border-[var(--border-mid)] bg-[var(--bg-elevated)] shadow-lg shadow-black/40 backdrop-blur"
    >
      {options.map((opt) => {
        const isSel = opt.value === value;
        return (
          <li
            key={opt.value}
            role="option"
            aria-selected={isSel}
            onClick={() => { onChange(opt.value); setOpen(false); }}
            className={`cursor-pointer px-3 py-2 text-[13px] transition-colors ${
              isSel
                ? "bg-[var(--accent-teal-soft)] text-[var(--accent-teal)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-glass-04)] hover:text-[var(--text-primary)]"
            }`}
          >
            {opt.label}
          </li>
        );
      })}
    </ul>,
    document.body
  ) : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (buttonRef.current) setRect(buttonRef.current.getBoundingClientRect());
          setOpen((o) => !o);
        }}
        className={`flex items-center justify-between gap-2 transition-colors focus:outline-none focus:border-[var(--accent-teal)] ${triggerBase}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-left">
          {selected?.label ?? placeholder ?? "Select…"}
        </span>
        <ChevronDown
          size={14}
          className={`text-[var(--text-muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {dropdown}
    </div>
  );
}
