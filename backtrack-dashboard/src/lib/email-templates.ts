/**
 * HTML email templates for BackTrack notifications.
 * All styles are inline for Gmail/Outlook compatibility.
 * Layout is table-based (no flexbox/grid in email clients).
 */

const F = `-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif`;
const MONO = `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace`;

// BackTrack.png resized to 40×40, circular alpha mask applied
const LOGO_B64 = `data:image/png;base64,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`;

export type RollbackEvent = {
  service: string;
  namespace?: string;
  platform: string;
  from_tag?: string;
  to_tag?: string;
  success: boolean;
  message: string;
  triggered_at: string;
  source: "manual" | "cicd" | "agent";
  anomaly_type?: "TSD" | "LSI" | "BOTH" | "MANUAL" | "AUTO";
  anomaly_detected_at?: string;
  rollback_completed_at?: string;
  mttr_seconds?: number;
};

export function fmtTs(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      timeZoneName: "short",
    });
  } catch { return iso; }
}

export function fmtMttr(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const ALGO_DESCRIPTIONS: Record<string, { label: string; detail: string }> = {
  TSD:    { label: "TSD — Time Series Decomposition", detail: "Detected metric drift in CPU, memory, latency or error rate via STL residual analysis (residual > 3×IQR for 3 consecutive readings)." },
  LSI:    { label: "LSI — Log Semantic Indexing",     detail: "Detected abnormal log patterns via TF-IDF + SVD cosine similarity. Novel or error-class log windows exceeded the baseline anomaly score." },
  BOTH:   { label: "TSD + LSI — Compound Failure",   detail: "Both metric drift (TSD) and log semantic anomaly (LSI) were independently triggered, indicating a compound failure event." },
  MANUAL: { label: "Manual Rollback",                 detail: "Rollback was triggered manually by an operator from the BackTrack dashboard." },
  AUTO:   { label: "Agent Auto-Rollback",             detail: "BackTrack agent automatically detected an anomaly and initiated rollback without operator intervention." },
};

function severityFor(e: RollbackEvent): { label: string; color: string; bg: string } {
  if (!e.success)                                                return { label: "CRITICAL", color: "#ef4444", bg: "rgba(239,68,68,0.08)"   };
  if (e.anomaly_type === "BOTH")                                 return { label: "HIGH",     color: "#f59e0b", bg: "rgba(245,158,11,0.08)"  };
  if (e.anomaly_type === "TSD" || e.anomaly_type === "LSI")      return { label: "MEDIUM",   color: "#f59e0b", bg: "rgba(245,158,11,0.06)"  };
  return                                                                { label: "LOW",      color: "#10b981", bg: "rgba(16,185,129,0.07)"  };
}

// ── Shared layout primitives ──────────────────────────────────────────────────

// Icon helper: text char in a styled container. Works in ALL email clients including Gmail.
// All chars chosen from non-emoji Unicode ranges (geometric/math/arrow blocks).
function ic(char: string, color: string, bg: string, border: string, w: number, h: number, fs: number): string {
  return `<span style="display:inline-block;width:${w}px;height:${h}px;border-radius:50%;background:${bg};border:1.5px solid ${border};text-align:center;line-height:${h}px;font-family:Arial,sans-serif;font-size:${fs}px;font-weight:700;color:${color};font-style:normal">${char}</span>`;
}
function icSq(char: string, color: string): string {
  return `<span style="display:inline-block;width:20px;height:20px;background:rgba(124,58,237,0.18);border-radius:5px;text-align:center;line-height:20px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:${color};vertical-align:middle;margin-right:7px">${char}</span>`;
}
function icBadge(char: string, color: string): string {
  return `<span style="display:inline-block;width:34px;height:34px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.22);border-radius:8px;text-align:center;line-height:34px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:${color}">${char}</span>`;
}

function logoHtml(): string {
  return `<span style="display:inline-block;width:52px;height:52px;border-radius:50%;border:1.5px solid rgba(124,58,237,0.55);background:#ffffff;vertical-align:middle;margin-right:10px;overflow:hidden"><img src="${LOGO_B64}" alt="BackTrack" width="52" height="52" style="display:block;border-radius:50%"></span><span style="font-family:${F};font-size:15px;font-weight:700;color:#f8fafc;letter-spacing:-0.3px;vertical-align:middle">BackTrack</span>`;
}

function emailWrapper(preheader: string, cardHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <title>BackTrack</title>
</head>
<body style="margin:0;padding:0;background:#09090b;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#09090b">${preheader} &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#09090b">
  <tr><td align="center" style="padding:40px 16px">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:580px;margin:0 auto">
    <tr><td>${cardHtml}</td></tr>
    <tr><td style="padding:24px 4px 8px;text-align:center">
      <p style="margin:0;font-family:${F};font-size:11px;color:#374151;line-height:1.7">
        <strong style="color:#4b5563">BackTrack</strong> &middot; Local-first Kubernetes / Docker Observability<br>
        Automated self-healing infrastructure monitoring
      </p>
    </td></tr>
  </table>
  </td></tr>
  </table>
</body>
</html>`;
}

// ── Connection Success Email ───────────────────────────────────────────────────

export function formatConnectionSuccessText(email: string, timestamp: string): string {
  return [
    "BackTrack — Email Notifications Active",
    "=".repeat(44),
    "",
    "Your email has been successfully connected to BackTrack.",
    "You will now receive alerts for rollbacks and self-healing actions.",
    "",
    "CONNECTION DETAILS",
    "-".repeat(44),
    `Connected email : ${email}`,
    `Connected at    : ${timestamp}`,
    "",
    "WHAT YOU'LL RECEIVE",
    "-".repeat(44),
    "• Rollback alerts with full incident details and affected service info",
    "• MTTR (Mean Time to Recovery) metrics tracked per incident",
    "• Anomaly detection reports — TSD metric drift & LSI log analysis",
    "• Automatic success confirmations when self-healing completes",
    "",
    `Sent by BackTrack · ${fmtTs(new Date().toISOString())}`,
  ].join("\n");
}

export function formatConnectionSuccessHtml(email: string, timestamp: string): string {
  type Feature = { char: string; color: string; iconBg: string; iconBorder: string; title: string; desc: string };
  const features: Feature[] = [
    { char: "!",  color: "#f59e0b", iconBg: "rgba(245,158,11,0.12)", iconBorder: "rgba(245,158,11,0.28)",  title: "Rollback Alerts",        desc: "Instant notifications with full incident details, affected services, and actions taken." },
    { char: "↑", color: "#6366f1", iconBg: "rgba(99,102,241,0.12)", iconBorder: "rgba(99,102,241,0.28)",  title: "MTTR Metrics",           desc: "Mean Time to Recovery tracked automatically for every rollback event." },
    { char: "≡", color: "#10b981", iconBg: "rgba(16,185,129,0.12)", iconBorder: "rgba(16,185,129,0.28)", title: "Anomaly Reports",        desc: "TSD metric drift analysis and LSI log semantic indexing results." },
    { char: "✓", color: "#f59e0b", iconBg: "rgba(245,158,11,0.12)", iconBorder: "rgba(245,158,11,0.28)", title: "Recovery Confirmations", desc: "Instant alerts when self-healing completes successfully." },
  ];

  const featureCols = features.map(f => `
    <td width="25%" style="vertical-align:top;padding:6px">
      <table cellpadding="0" cellspacing="0" width="100%" height="190" style="background:#111115;border-radius:10px;border:1px solid #252530">
      <tr><td style="padding:18px 10px 16px;text-align:center;vertical-align:top">
        ${ic(f.char, f.color, f.iconBg, f.iconBorder, 46, 46, 20)}
        <div style="margin-top:11px;font-family:${F};font-size:12px;font-weight:700;color:#f8fafc;line-height:1.3">${f.title}</div>
        <div style="margin-top:5px;font-family:${F};font-size:11px;color:#6b7280;line-height:1.5">${f.desc}</div>
      </td></tr>
      </table>
    </td>`).join("");

  const card = `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#111115;border-radius:16px;border:1px solid #1e1e28;overflow:hidden">

    <!-- Nav header: dark navy gradient -->
    <tr><td style="padding:0 28px;background:linear-gradient(135deg,#0e0920 0%,#180c35 55%,#0b0f20 100%)">
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td style="padding:20px 0">${logoHtml()}</td>
        <td align="right" style="padding:20px 0">
          <span style="font-family:${F};font-size:11px;font-weight:700;letter-spacing:0.08em;color:#10b981">&#10003;&nbsp; CONNECTED</span>
        </td>
      </tr></table>
    </td></tr>

    <!-- Hero -->
    <tr><td style="padding:44px 32px 40px;text-align:center;border-bottom:1px solid #1e1e28">
      <!-- Outer glow ring -->
      <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 26px">
      <tr><td width="84" height="84" style="background:rgba(16,185,129,0.07);border:2px solid rgba(16,185,129,0.18);border-radius:50%;text-align:center;vertical-align:middle">
        <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto">
        <tr><td width="60" height="60" style="background:rgba(16,185,129,0.14);border:2px solid rgba(16,185,129,0.45);border-radius:50%;text-align:center;vertical-align:middle">
          <span style="font-family:Arial,sans-serif;font-size:28px;font-weight:700;color:#10b981;line-height:60px;display:block">&#10003;</span>
        </td></tr>
        </table>
      </td></tr>
      </table>
      <h1 style="margin:0 0 12px;font-family:${F};font-size:26px;font-weight:800;color:#f8fafc;letter-spacing:-0.5px">
        Email Notifications <span style="color:#10b981">Active!</span>
      </h1>
      <p style="margin:0 auto;font-family:${F};font-size:14px;color:#6b7280;line-height:1.75;max-width:400px">
        Great! Your email has been successfully connected to BackTrack.<br>
        You&rsquo;ll now receive important alerts about rollbacks, anomalies, and system recovery.
      </p>
    </td></tr>

    <!-- Connection Details -->
    <tr><td style="padding:24px 28px;border-bottom:1px solid #1e1e28">
      <table cellpadding="0" cellspacing="0" width="100%" style="background:#0c0c0f;border-radius:12px;border:1px solid #1e1e28">
        <!-- Header row -->
        <tr><td colspan="3" style="padding:14px 20px;border-bottom:1px solid #1e1e28">
          <span style="font-family:${F};font-size:13px;font-weight:700;color:#f8fafc">
            ${icSq("@", "#a78bfa")}Connection Details
          </span>
        </td></tr>
        <!-- Two info columns -->
        <tr>
          <td width="50%" style="padding:18px 20px;vertical-align:top">
            <table cellpadding="0" cellspacing="0"><tr>
              <td width="40" style="vertical-align:top;padding-top:3px">
                ${icBadge("@", "#a78bfa")}
              </td>
              <td style="padding-left:10px;vertical-align:top">
                <div style="font-family:${F};font-size:11px;color:#6b7280;margin-bottom:4px">Connected Email</div>
                <div style="font-family:${F};font-size:13px;font-weight:700;color:#f8fafc">${email}</div>
              </td>
            </tr></table>
          </td>
          <td width="1" style="background:linear-gradient(to bottom,transparent 10%,#252530 10%,#252530 90%,transparent 90%)">&nbsp;</td>
          <td width="50%" style="padding:18px 20px;vertical-align:top">
            <table cellpadding="0" cellspacing="0"><tr>
              <td width="40" style="vertical-align:top;padding-top:3px">
                ${icBadge("#", "#a78bfa")}
              </td>
              <td style="padding-left:10px;vertical-align:top">
                <div style="font-family:${F};font-size:11px;color:#6b7280;margin-bottom:4px">Connected At</div>
                <div style="font-family:${F};font-size:13px;font-weight:700;color:#f8fafc">${timestamp}</div>
              </td>
            </tr></table>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- What You'll Receive: 4-column cards -->
    <tr><td style="padding:24px 28px;border-bottom:1px solid #1e1e28">
      <table cellpadding="0" cellspacing="0" width="100%" style="background:#0c0c0f;border-radius:12px;border:1px solid #1e1e28">
        <tr><td colspan="4" style="padding:14px 20px;border-bottom:1px solid #1e1e28">
          <span style="font-family:${F};font-size:13px;font-weight:700;color:#f8fafc">
            ${icSq("◉", "#a78bfa")}What You&rsquo;ll Receive
          </span>
        </td></tr>
        <tr><td colspan="4" style="padding:14px">
          <table cellpadding="0" cellspacing="0" width="100%">
          <tr>${featureCols}</tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <!-- CTA Banner -->
    <tr><td style="padding:24px 28px;border-bottom:1px solid #1e1e28">
      <table cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(135deg,#1a0e38 0%,#2a1860 100%);border-radius:12px;border:1px solid rgba(124,58,237,0.25)">
      <tr>
        <td style="padding:20px 22px;vertical-align:middle">
          <div style="font-family:${F};font-size:14px;font-weight:700;color:#f8fafc;margin-bottom:5px"><span style="font-family:Arial,sans-serif;color:#a78bfa;font-size:14px">&#9670;</span>&nbsp; We&rsquo;re here to keep your systems healthy.</div>
          <div style="font-family:${F};font-size:12px;color:#a78bfa;line-height:1.65;max-width:300px">BackTrack monitors your infrastructure 24/7 and will notify you the moment something needs your attention.</div>
        </td>
        <td align="right" style="padding:20px 22px;vertical-align:middle;white-space:nowrap">
          <span style="display:inline-block;background:#7c3aed;padding:11px 20px;border-radius:8px;font-family:${F};font-size:12px;font-weight:700;color:#ffffff;letter-spacing:0.01em">Open Dashboard &nbsp;&#8594;</span>
        </td>
      </tr>
      </table>
    </td></tr>

    <!-- Footer -->
    <tr><td style="padding:22px 28px;background:#070709;border-top:1px solid #131318">
      <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="vertical-align:top">
          ${logoHtml()}
          <div style="margin-top:8px;font-family:${F};font-size:11px;color:#4b5563">Automated self-healing. Real-time reliability.</div>
        </td>
        <td style="vertical-align:top;padding-left:20px">
          <div style="font-family:${F};font-size:11px;font-weight:600;color:#6b7280;margin-bottom:7px">Questions or need help?</div>
          <div style="font-family:${F};font-size:11px;color:#4b5563;line-height:2">
            &rsaquo;&nbsp; Visit our docs<br>
            &rsaquo;&nbsp; Contact support
          </div>
        </td>
        <td align="right" style="vertical-align:top">
          <div style="font-family:${F};font-size:11px;font-weight:600;color:#6b7280;margin-bottom:7px">Stay Connected</div>
          <div style="font-family:${F};font-size:11px;color:#4b5563;line-height:2">
            &rsaquo;&nbsp; GitHub<br>
            &rsaquo;&nbsp; Website
          </div>
        </td>
      </tr>
      <tr><td colspan="3" style="padding-top:16px;border-top:1px solid #1a1a22;text-align:center">
        <p style="margin:0;font-family:${F};font-size:10px;color:#374151;line-height:1.8">
          &copy; 2026 BackTrack. All rights reserved.<br>
          You&rsquo;re receiving this email because you connected your email to BackTrack.
        </p>
      </td></tr>
      </table>
    </td></tr>

  </table>`;

  return emailWrapper(
    "Your email notifications are now active — BackTrack will alert you on every rollback",
    card,
  );
}

// ── Rollback Alert Email ───────────────────────────────────────────────────────

export function formatRollbackText(e: RollbackEvent): string {
  const algo = e.anomaly_type ? ALGO_DESCRIPTIONS[e.anomaly_type] : null;
  const mttr = e.mttr_seconds != null ? fmtMttr(e.mttr_seconds) : null;
  return [
    `[BackTrack] ${e.success ? "ROLLBACK SUCCEEDED" : "ROLLBACK FAILED"}`,
    "",
    `Service   : ${e.service}${e.namespace ? ` (${e.namespace})` : ""}`,
    `Platform  : ${e.platform}`,
    e.from_tag ? `From tag  : ${e.from_tag}` : "",
    e.to_tag   ? `To tag    : ${e.to_tag}`   : "",
    "",
    "--- Anomaly Detection ---",
    algo ? `Algorithm : ${algo.label}` : "",
    algo ? `Detail    : ${algo.detail}` : "",
    "",
    "--- Timeline ---",
    e.anomaly_detected_at   ? `Detected  : ${fmtTs(e.anomaly_detected_at)}`   : "",
    `Triggered : ${fmtTs(e.triggered_at)}`,
    e.rollback_completed_at ? `Completed : ${fmtTs(e.rollback_completed_at)}` : "",
    mttr ? `MTTR      : ${mttr}` : "",
    "",
    "--- Details ---",
    `Source    : ${e.source}`,
    `Message   : ${e.message}`,
    "",
    `Sent by BackTrack · ${fmtTs(new Date().toISOString())}`,
  ].filter(Boolean).join("\n");
}

export function formatRollbackHtml(e: RollbackEvent): string {
  const success      = e.success;
  const sev          = severityFor(e);
  const accentColor  = success ? "#10b981" : "#ef4444";
  const accentBg     = success ? "rgba(16,185,129,0.08)"   : "rgba(239,68,68,0.08)";
  const accentBorder = success ? "rgba(16,185,129,0.22)"   : "rgba(239,68,68,0.22)";
  const barGradient  = success ? "linear-gradient(90deg,#10b981,#34d399)" : "linear-gradient(90deg,#ef4444,#f87171)";
  const statusIcon   = success ? "&#10003;" : "&#10005;";
  const statusLabel  = success ? "Rollback Succeeded" : "Rollback Failed";
  const badgeText    = success ? "RECOVERY CONFIRMED" : "INCIDENT ALERT";
  const algo         = e.anomaly_type ? ALGO_DESCRIPTIONS[e.anomaly_type] : null;
  const mttr         = e.mttr_seconds != null ? fmtMttr(e.mttr_seconds) : null;
  const tsdActive    = e.anomaly_type === "TSD"  || e.anomaly_type === "BOTH";
  const lsiActive    = e.anomaly_type === "LSI"  || e.anomaly_type === "BOTH";

  const nextSteps = success ? [
    "Monitor your restored service in the BackTrack dashboard to confirm stability",
    "Review the anomaly root cause before re-deploying the affected version",
    "Consider adjusting detection thresholds if the anomaly was a false positive",
  ] : [
    "Immediate manual intervention may be required — check service status now",
    "Review rollback logs and the incident details below for root cause clues",
    "Ensure the target rollback image tag exists and is accessible to the runtime",
    "Contact your on-call engineer if the service remains degraded",
  ];

  const algoRow = (active: boolean, name: string, desc: string, last = false) => `
    <tr>
      <td width="32" style="padding:13px 0 13px 18px;vertical-align:top${last ? "" : ";border-bottom:1px solid #1a1a22"}">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;text-align:center;line-height:18px;font-size:10px;font-family:${F};background:${active ? "rgba(94,234,212,0.1)" : "rgba(75,85,99,0.08)"};border:1px solid ${active ? "rgba(94,234,212,0.28)" : "rgba(75,85,99,0.2)"};color:${active ? "#5eead4" : "#4b5563"}">${active ? "&#10003;" : "&mdash;"}</span>
      </td>
      <td style="padding:13px 18px 13px 10px;vertical-align:top${last ? "" : ";border-bottom:1px solid #1a1a22"}">
        <div style="font-family:${F};font-size:12px;font-weight:600;color:${active ? "#5eead4" : "#4b5563"};margin-bottom:4px">${name}</div>
        <div style="font-family:${F};font-size:11px;color:#6b7280;line-height:1.6">${desc}</div>
      </td>
    </tr>`;

  const timelineRow = (dotColor: string, label: string, ts?: string) => !ts ? "" : `
    <tr>
      <td width="24" style="padding:9px 0;text-align:center;vertical-align:top">
        <span style="display:inline-block;width:10px;height:10px;background:${dotColor};border-radius:50%;margin-top:2px"></span>
      </td>
      <td style="padding:9px 0 9px 10px;border-bottom:1px solid #1a1a22">
        <table cellpadding="0" cellspacing="0" width="100%"><tr>
          <td style="font-family:${F};font-size:12px;color:#9ca3af">${label}</td>
          <td align="right" style="font-family:${F};font-size:12px;color:#d1d5db">${fmtTs(ts)}</td>
        </tr></table>
      </td>
    </tr>`;

  const serviceRows = [
    ["Service",         `<span style="font-family:${F};font-size:13px;font-weight:600;color:#f8fafc">${e.service}${e.namespace ? `<span style="color:#6b7280;font-weight:400"> (${e.namespace})</span>` : ""}</span>`],
    ["Platform",        `<span style="font-family:${F};font-size:13px;color:#e2e8f0;text-transform:capitalize">${e.platform}</span>`],
    ...(e.from_tag ? [["Rolled back from", `<code style="font-family:${MONO};font-size:12px;background:#1a1a22;padding:2px 8px;border-radius:4px;color:#fbbf24">${e.from_tag}</code>`]] : []),
    ...(e.to_tag   ? [["Restored to",      `<code style="font-family:${MONO};font-size:12px;background:#1a1a22;padding:2px 8px;border-radius:4px;color:#34d399">${e.to_tag}</code>`]] : []),
    ["Triggered by",    `<span style="font-family:${F};font-size:13px;color:#e2e8f0;text-transform:capitalize">${e.source}</span>`],
  ] as [string, string][];

  const card = `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#111115;border-radius:14px;border:1px solid #1e1e28;overflow:hidden">
    <tr><td height="3" style="background:${barGradient};font-size:0;line-height:3px">&nbsp;</td></tr>

    <!-- Header -->
    <tr><td style="padding:22px 28px;border-bottom:1px solid #1e1e28">
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td>${logoHtml()}</td>
        <td align="right">
          <span style="display:inline-block;padding:3px 11px;border-radius:999px;font-family:${F};font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${accentColor};background:${accentBg};border:1px solid ${accentBorder}">${badgeText}</span>
        </td>
      </tr></table>
    </td></tr>

    <!-- Status Hero -->
    <tr><td style="padding:26px 28px;background:${accentBg};border-bottom:1px solid #1e1e28">
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td style="vertical-align:middle">
          <table cellpadding="0" cellspacing="0"><tr>
            <td width="56" style="vertical-align:middle;padding-right:14px">
              <span style="display:block;width:48px;height:48px;background:${accentBg};border:2px solid ${accentBorder};border-radius:50%;text-align:center;line-height:48px;font-family:${F};font-size:22px;color:${accentColor}">${statusIcon}</span>
            </td>
            <td style="vertical-align:middle">
              <div style="font-family:${F};font-size:20px;font-weight:700;color:#f8fafc;letter-spacing:-0.4px">${statusLabel}</div>
              <div style="font-family:${F};font-size:12px;color:#6b7280;margin-top:3px">${fmtTs(e.triggered_at)}</div>
            </td>
          </tr></table>
        </td>
        <td align="right" style="vertical-align:middle">
          <span style="display:inline-block;padding:4px 12px;border-radius:6px;font-family:${F};font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${sev.color};background:${sev.bg};border:1px solid ${sev.color}33">${sev.label}</span>
        </td>
      </tr></table>
    </td></tr>

    <!-- Affected Service -->
    <tr><td style="padding:22px 28px;border-bottom:1px solid #1e1e28">
      <p style="margin:0 0 13px;font-family:${F};font-size:10px;font-weight:700;color:#4b5563;letter-spacing:0.12em;text-transform:uppercase">Affected Service</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="background:#0c0c0f;border-radius:10px;border:1px solid #1e1e28">
        ${serviceRows.map(([label, value], i, arr) => `
        <tr><td style="padding:12px 18px${i < arr.length - 1 ? ";border-bottom:1px solid #1a1a22" : ""}">
          <table cellpadding="0" cellspacing="0" width="100%"><tr>
            <td width="145" style="font-family:${F};font-size:12px;color:#6b7280;vertical-align:middle">${label}</td>
            <td style="vertical-align:middle">${value}</td>
          </tr></table>
        </td></tr>`).join("")}
      </table>
    </td></tr>

    <!-- Anomaly Detection -->
    <tr><td style="padding:22px 28px;border-bottom:1px solid #1e1e28">
      <p style="margin:0 0 13px;font-family:${F};font-size:10px;font-weight:700;color:#4b5563;letter-spacing:0.12em;text-transform:uppercase">Anomaly Detection</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="background:#0c0c0f;border-radius:10px;border:1px solid #1e1e28">
        ${algoRow(tsdActive, "TSD &mdash; Time Series Decomposition (STL)", "Monitors CPU, memory, HTTP latency, and error rate. Runs STL decomposition every scrape cycle and flags anomalies when the residual exceeds 3&times; IQR for 3 consecutive readings.")}
        ${algoRow(lsiActive, "LSI &mdash; Log Semantic Indexing (SVD)",     "Streams container logs in real time. Builds a TF-IDF matrix from the baseline corpus, applies Truncated SVD (k=50), and classifies each window via cosine similarity.", true)}
        ${algo ? `
        <tr><td colspan="2" style="padding:12px 18px;border-top:1px solid #1a1a22;background:rgba(94,234,212,0.03)">
          <p style="margin:0;font-family:${F};font-size:11px;color:#9ca3af;line-height:1.65;border-left:2px solid rgba(94,234,212,0.3);padding-left:10px">${algo.detail}</p>
        </td></tr>` : ""}
      </table>
    </td></tr>

    <!-- Recovery Timeline -->
    <tr><td style="padding:22px 28px;border-bottom:1px solid #1e1e28">
      <p style="margin:0 0 13px;font-family:${F};font-size:10px;font-weight:700;color:#4b5563;letter-spacing:0.12em;text-transform:uppercase">Recovery Timeline</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${timelineRow("#f59e0b", "Anomaly detected",  e.anomaly_detected_at)}
        ${timelineRow("#6366f1", "Rollback triggered", e.triggered_at)}
        ${timelineRow(success ? "#10b981" : "#ef4444", success ? "Recovery complete" : "Rollback failed", e.rollback_completed_at)}
      </table>
      ${mttr ? `
      <table cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;background:${accentBg};border-radius:10px;border:1px solid ${accentBorder}">
      <tr><td style="padding:16px 20px">
        <div style="font-family:${F};font-size:10px;font-weight:700;color:#4b5563;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:5px">Mean Time to Recovery</div>
        <div style="font-family:${MONO};font-size:30px;font-weight:700;color:${accentColor};letter-spacing:-0.5px">${mttr}</div>
      </td></tr>
      </table>` : ""}
    </td></tr>

    <!-- Incident Details -->
    <tr><td style="padding:22px 28px;border-bottom:1px solid #1e1e28">
      <p style="margin:0 0 10px;font-family:${F};font-size:10px;font-weight:700;color:#4b5563;letter-spacing:0.12em;text-transform:uppercase">Incident Details</p>
      <p style="margin:0;font-family:${F};font-size:13px;color:#9ca3af;line-height:1.7;background:#0c0c0f;padding:14px 18px;border-radius:8px;border:1px solid #1e1e28">${e.message}</p>
    </td></tr>

    <!-- Recommended Next Steps -->
    <tr><td style="padding:22px 28px">
      <p style="margin:0 0 14px;font-family:${F};font-size:10px;font-weight:700;color:#4b5563;letter-spacing:0.12em;text-transform:uppercase">Recommended Next Steps</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${nextSteps.map((step, i) => `
        <tr>
          <td width="28" style="padding:8px 0;vertical-align:top">
            <span style="font-family:${MONO};font-size:11px;font-weight:700;color:#7c3aed">${String(i + 1).padStart(2, "0")}</span>
          </td>
          <td style="padding:8px 0 8px 8px;font-family:${F};font-size:13px;color:#9ca3af;line-height:1.65">${step}</td>
        </tr>`).join("")}
      </table>
    </td></tr>
  </table>`;

  const preheader = success
    ? `Rollback succeeded for ${e.service}${mttr ? ` — recovered in ${mttr}` : ""}`
    : `Action required: rollback FAILED for ${e.service} — immediate attention needed`;

  return emailWrapper(preheader, card);
}
