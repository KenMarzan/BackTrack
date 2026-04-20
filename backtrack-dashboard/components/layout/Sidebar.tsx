"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ScrollText, GitBranch } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/versions", label: "Versions", icon: GitBranch },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex flex-col w-64 border-r border-gray-800 bg-surface p-4 gap-2">
        <div className="mb-6 px-3">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Backtrack
          </h1>
          <p className="text-xs text-gray-500 mt-1">Container Health</p>
        </div>

        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                active
                  ? "bg-accent/20 text-white font-medium"
                  : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-gray-800 bg-surface">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-[11px] transition ${
                active ? "text-white" : "text-gray-500"
              }`}
            >
              <Icon size={20} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
