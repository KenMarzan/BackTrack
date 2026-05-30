/**
 * HTML email templates for BackTrack notifications.
 * All styles are inline for Gmail/Outlook compatibility.
 * Layout is table-based (no flexbox/grid in email clients).
 */

const F = `-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif`;
const MONO = `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace`;

// Logo is embedded as a CID attachment by nodemailer — reference via cid:backtrack-logo
const LOGO_SRC = `cid:backtrack-logo`;

export type TsdMetricEvidence = {
  name: string;
  value: number;
  unit: string;
  residual?: number;
  z_score?: number;
  drifting?: boolean;
};

export type TsdEvidence = {
  is_drifting: boolean;
  has_crashed: boolean;
  consecutive_cycles: number;
  metrics: TsdMetricEvidence[];
};

export type LsiEvidence = {
  is_anomalous: boolean;
  current_score: number;
  baseline_mean: number;
  threshold: number;
  is_error_anomalous: boolean;
  error_score: number;
  error_threshold: number;
  window_counts?: Record<string, number>;
  recent_lines?: string[];
};

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
  tsd_evidence?: TsdEvidence;
  lsi_evidence?: LsiEvidence;
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

function severityFor(e: RollbackEvent): { label: string; color: string; bg: string; border: string } {
  if (!e.success)                                                return { label: "CRITICAL", color: "#b91c1c", bg: "#fef2f2",   border: "#fecaca" };
  if (e.anomaly_type === "BOTH")                                 return { label: "HIGH",     color: "#92400e", bg: "#fffbeb",   border: "#fde68a" };
  if (e.anomaly_type === "TSD" || e.anomaly_type === "LSI")      return { label: "MEDIUM",   color: "#92400e", bg: "#fffbeb",   border: "#fde68a" };
  return                                                                { label: "LOW",      color: "#065f46", bg: "#f0fdf4",   border: "#bbf7d0" };
}

// ── Shared layout ──────────────────────────────────────────────────────────────

function emailWrapper(preheader: string, cardHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BackTrack</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#0d1117">${preheader} &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0d1117">
  <tr><td align="center" style="padding:0">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:580px;margin:0 auto">

    <!-- Dark brand header -->
    <tr><td style="padding:40px 32px 36px;text-align:center;background:#0d1117">
      <img src="${LOGO_SRC}" alt="BackTrack" width="64" height="64" style="display:block;margin:0 auto 16px">
      <div style="font-family:${F};font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;margin-bottom:6px">BackTrack</div>
      <div style="font-family:${F};font-size:12px;color:#5eead4;letter-spacing:0.18em;text-transform:uppercase">Self-Healing Observability</div>
    </td></tr>

    <!-- Card -->
    <tr><td style="padding:0 16px">${cardHtml}</td></tr>

    <!-- Footer -->
    <tr><td style="padding:24px 16px 40px;text-align:center;background:#0d1117">
      <p style="margin:0;font-family:${F};font-size:11px;color:#374151;line-height:1.8">
        BackTrack &middot; Local-first Kubernetes / Docker Observability<br>
        You are receiving this because you connected your email to BackTrack.
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
  const features = [
    { cid: "icon-bell",   bg: "#f5f3ff", border: "#ddd6fe", title: "Rollback Alerts",        desc: "Instant notifications with full incident details, affected services, and actions taken." },
    { cid: "icon-timer",  bg: "#ecfeff", border: "#a5f3fc", title: "MTTR Metrics",           desc: "Mean Time to Recovery tracked automatically for every rollback event." },
    { cid: "icon-chart",  bg: "#fffbeb", border: "#fde68a", title: "Anomaly Reports",        desc: "TSD metric drift analysis and LSI log semantic indexing results." },
    { cid: "icon-shield", bg: "#f0fdf4", border: "#bbf7d0", title: "Recovery Confirmations", desc: "Instant alerts when self-healing completes successfully." },
  ];

  const featureRows = features.map((f, i) => `
    <tr>
      <td style="padding:16px 20px${i < features.length - 1 ? ";border-bottom:1px solid #f3f4f6" : ""}">
        <table cellpadding="0" cellspacing="0" width="100%"><tr>
          <td width="44" style="vertical-align:middle;text-align:center">
            <img src="cid:${f.cid}" width="32" height="32" alt="" style="display:block;margin:0 auto">
          </td>
          <td style="padding-left:14px;vertical-align:middle">
            <div style="font-family:${F};font-size:13px;font-weight:700;color:#111827;margin-bottom:3px">${f.title}</div>
            <div style="font-family:${F};font-size:12px;color:#6b7280;line-height:1.65">${f.desc}</div>
          </td>
        </tr></table>
      </td>
    </tr>`).join("");

  const card = `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.22)">

    <!-- Hero -->
    <tr><td style="padding:44px 40px 36px;text-align:center;background:#ffffff;border-bottom:1px solid #f0f0f0">
      <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 22px">
      <tr><td style="text-align:center">
        <img src="cid:icon-success" width="68" height="68" alt="Connected" style="display:block">
      </td></tr>
      </table>
      <h1 style="margin:0 0 12px;font-family:${F};font-size:24px;font-weight:800;color:#111827;letter-spacing:-0.4px">You&rsquo;re all set!</h1>
      <p style="margin:0 auto;font-family:${F};font-size:14px;color:#6b7280;line-height:1.75;max-width:360px">
        Email alerts are now active. BackTrack will notify you the moment an anomaly is detected or a rollback fires.
      </p>
    </td></tr>

    <!-- Connection details -->
    <tr><td style="padding:28px 40px;border-bottom:1px solid #f0f0f0;background:#fafafa">
      <p style="margin:0 0 12px;font-family:${F};font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:0.12em;text-transform:uppercase">Connection Details</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="background:#ffffff;border-radius:8px;border:1px solid #e5e7eb">
        <tr>
          <td width="50%" style="padding:16px 18px;border-right:1px solid #e5e7eb">
            <div style="font-family:${F};font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px">Connected email</div>
            <div style="font-family:${F};font-size:13px;font-weight:600;color:#111827;word-break:break-all">${email}</div>
          </td>
          <td width="50%" style="padding:16px 18px">
            <div style="font-family:${F};font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px">Connected at</div>
            <div style="font-family:${F};font-size:13px;font-weight:600;color:#111827">${timestamp}</div>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- What you'll receive -->
    <tr><td style="padding:28px 40px 32px;background:#ffffff">
      <p style="margin:0 0 14px;font-family:${F};font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:0.12em;text-transform:uppercase">What You&rsquo;ll Receive</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden">
        ${featureRows}
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
    ...(e.tsd_evidence ? [
      `TSD Status: ${e.tsd_evidence.is_drifting ? "DRIFTING" : "Normal"}${e.tsd_evidence.has_crashed ? " (CRASHED)" : ""}`,
      `Cycles    : ${e.tsd_evidence.consecutive_cycles} / 3`,
      ...e.tsd_evidence.metrics.filter(m => m.drifting).map(m =>
        `  ${m.name.padEnd(10)}: ${m.value}${m.unit}  residual ${m.residual ?? "—"}  z ${m.z_score ?? "—"} [ANOMALOUS]`
      ),
    ] : []),
    ...(e.lsi_evidence ? [
      `LSI Score : ${e.lsi_evidence.current_score.toFixed(4)} (baseline ${e.lsi_evidence.baseline_mean.toFixed(4)}, threshold ${e.lsi_evidence.threshold.toFixed(4)})`,
      `Error Score: ${e.lsi_evidence.error_score.toFixed(4)} (threshold ${e.lsi_evidence.error_threshold.toFixed(4)})`,
      ...(e.lsi_evidence.recent_lines?.length ? [
        "Recent anomalous log lines:",
        ...e.lsi_evidence.recent_lines.slice(0, 3).map(l => {
          try {
            const p = JSON.parse(l);
            if (p && typeof p === "object") {
              const sev = p.s ?? p.level ?? "";
              const comp = p.c ?? p.component ?? "";
              const msg = p.msg ?? p.message ?? "";
              return `  › [${[sev, comp].filter(Boolean).join("|")}] ${msg}`;
            }
          } catch { /* not JSON */ }
          return `  › ${l}`;
        }),
      ] : []),
    ] : []),
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
  const accentColor  = success ? "#16a34a" : "#dc2626";
  const accentBg     = success ? "#f0fdf4"               : "#fef2f2";
  const accentBorder = success ? "#86efac"               : "#fecaca";
  const barColor     = success ? "#16a34a"               : "#dc2626";
  const statusIcon   = success ? "&#10003;"              : "&#10005;";
  const statusLabel  = success ? "Rollback Succeeded"    : "Rollback Failed";
  const algo         = e.anomaly_type ? ALGO_DESCRIPTIONS[e.anomaly_type] : null;
  const mttr         = e.mttr_seconds != null ? fmtMttr(e.mttr_seconds) : null;
  const tsdActive    = e.anomaly_type === "TSD"  || e.anomaly_type === "BOTH";
  const lsiActive    = e.anomaly_type === "LSI"  || e.anomaly_type === "BOTH";

  const nextSteps = success ? [
    "Monitor your restored service in the BackTrack dashboard to confirm stability.",
    "Review the anomaly root cause before re-deploying the affected version.",
    "Consider adjusting detection thresholds if the anomaly was a false positive.",
  ] : [
    "Immediate manual intervention may be required — check service status now.",
    "Review rollback logs and the incident details below for root cause clues.",
    "Ensure the target rollback image tag exists and is accessible to the runtime.",
  ];

  const serviceRows: [string, string][] = [
    ["Service",  `${e.service}${e.namespace ? ` <span style="color:#9ca3af">(${e.namespace})</span>` : ""}`],
    ["Platform", e.platform],
    ...(e.from_tag ? [["Rolled back from", `<code style="font-family:${MONO};font-size:12px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:3px">${e.from_tag}</code>`] as [string,string]] : []),
    ...(e.to_tag   ? [["Restored to",      `<code style="font-family:${MONO};font-size:12px;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:3px">${e.to_tag}</code>`]   as [string,string]] : []),
    ["Triggered by", e.source],
  ];

  const timelineRow = (emoji: string, iconBg: string, label: string, ts?: string) => !ts ? "" : `
    <tr>
      <td width="36" style="padding:10px 0;text-align:center;vertical-align:middle">
        <span style="display:inline-block;width:30px;height:30px;background:${iconBg};border-radius:50%;text-align:center;line-height:30px;font-size:15px;vertical-align:middle">${emoji}</span>
      </td>
      <td style="padding:10px 0 10px 12px;border-bottom:1px solid #f3f4f6">
        <table cellpadding="0" cellspacing="0" width="100%"><tr>
          <td style="font-family:${F};font-size:13px;font-weight:500;color:#374151">${label}</td>
          <td align="right" style="font-family:${F};font-size:12px;color:#9ca3af">${fmtTs(ts)}</td>
        </tr></table>
      </td>
    </tr>`;

  const card = `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.18)">

    <!-- Status hero — full-width colored band -->
    <tr><td style="padding:32px 32px 28px;background:${accentBg};border-bottom:3px solid ${accentBorder}">
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td style="vertical-align:middle">
          <table cellpadding="0" cellspacing="0"><tr>
            <td width="60" style="vertical-align:middle;padding-right:16px">
              <img src="cid:${success ? "icon-success" : "icon-error"}" width="52" height="52" alt="${statusLabel}" style="display:block">
            </td>
            <td style="vertical-align:middle">
              <div style="font-family:${F};font-size:20px;font-weight:800;color:#111827;letter-spacing:-0.4px">${statusLabel}</div>
              <div style="font-family:${F};font-size:12px;color:#6b7280;margin-top:4px">${fmtTs(e.triggered_at)}</div>
            </td>
          </tr></table>
        </td>
        <td align="right" style="vertical-align:middle">
          <span style="display:inline-block;padding:4px 12px;border-radius:6px;font-family:${F};font-size:11px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${sev.color};background:${sev.bg};border:1px solid ${sev.border}">${sev.label}</span>
          ${mttr ? `<div style="margin-top:10px;text-align:right"><div style="font-family:${F};font-size:10px;font-weight:600;color:#9ca3af;letter-spacing:0.1em;text-transform:uppercase">MTTR</div><div style="font-family:${MONO};font-size:26px;font-weight:800;color:${accentColor};letter-spacing:-0.5px;line-height:1.1">${mttr}</div></div>` : ""}
        </td>
      </tr></table>
    </td></tr>

    <!-- Affected service -->
    <tr><td style="padding:20px 28px;border-bottom:1px solid #f3f4f6">
      <p style="margin:0 0 10px;font-family:${F};font-size:10px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase">Affected Service</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb">
        ${serviceRows.map(([label, value], i, arr) => `
        <tr><td style="padding:10px 16px${i < arr.length - 1 ? ";border-bottom:1px solid #f3f4f6" : ""}">
          <table cellpadding="0" cellspacing="0" width="100%"><tr>
            <td width="140" style="font-family:${F};font-size:12px;color:#9ca3af">${label}</td>
            <td style="font-family:${F};font-size:13px;font-weight:500;color:#111827">${value}</td>
          </tr></table>
        </td></tr>`).join("")}
      </table>
    </td></tr>

    <!-- Anomaly detection -->
    <tr><td style="padding:20px 28px;border-bottom:1px solid #f3f4f6">
      <p style="margin:0 0 10px;font-family:${F};font-size:10px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase">Anomaly Detection</p>
      <table cellpadding="0" cellspacing="0" width="100%" style="background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb">

        ${(() => {
          const tev = e.tsd_evidence;
          const triggered = tsdActive;
          const statusText = triggered ? "TRIGGERED" : (tev ? "NORMAL" : "NO DATA");
          const badgeColor  = triggered ? "#dc2626" : "#6b7280";
          const badgeBg     = triggered ? "#fef2f2" : "#f3f4f6";
          const badgeBorder = triggered ? "#fecaca" : "#e5e7eb";

          const headerRow = `<tr><td colspan="2" style="padding:12px 16px;border-bottom:1px solid #f3f4f6">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="font-family:${F};font-size:12px;font-weight:600;color:${triggered ? "#dc2626" : "#374151"}">
                TSD &mdash; Time Series Decomposition
              </td>
              <td align="right">
                <span style="padding:2px 8px;border-radius:3px;font-family:${F};font-size:10px;font-weight:600;color:${badgeColor};background:${badgeBg};border:1px solid ${badgeBorder}">${statusText}</span>
              </td>
            </tr></table>
          </td></tr>`;

          if (!tev) return headerRow + `<tr><td colspan="2" style="padding:10px 16px;border-bottom:1px solid #f3f4f6"><span style="font-family:${F};font-size:12px;color:#9ca3af">Metric data unavailable</span></td></tr>`;

          const metricRows = tev.metrics.map((m, i, arr) => {
            const isLast = i === arr.length - 1;
            const residual = m.residual != null ? `${m.residual > 0 ? "+" : ""}${m.residual.toFixed(3)}` : "—";
            const zScore   = m.z_score  != null ? `${m.z_score  > 0 ? "+" : ""}${m.z_score.toFixed(2)}`  : "—";
            return `<tr>
              <td width="100" style="padding:9px 16px;font-family:${F};font-size:12px;color:#6b7280;vertical-align:middle${isLast ? "" : ";border-bottom:1px solid #f3f4f6"}">${m.name}</td>
              <td style="padding:9px 16px 9px 0;vertical-align:middle${isLast ? "" : ";border-bottom:1px solid #f3f4f6"}">
                <span style="font-family:${MONO};font-size:12px;font-weight:600;color:${m.drifting ? "#dc2626" : "#111827"}">${m.value.toFixed(m.unit === "MB" ? 1 : 2)} ${m.unit}</span>
                <span style="font-family:${MONO};font-size:11px;color:#9ca3af;margin-left:10px">residual ${residual}</span>
                <span style="font-family:${MONO};font-size:11px;color:${m.drifting ? "#dc2626" : "#9ca3af"};margin-left:8px">z ${zScore}</span>
                ${m.drifting ? `<span style="font-family:${F};font-size:10px;font-weight:600;color:#dc2626;margin-left:8px">ANOMALOUS</span>` : ""}
              </td>
            </tr>`;
          }).join("");

          const cyclesHtml = tev.has_crashed
            ? `<span style="font-family:${F};font-size:12px;font-weight:600;color:#dc2626">Container crash / restart detected</span>`
            : `<span style="font-family:${F};font-size:12px;color:#6b7280">Anomaly cycles: </span><span style="font-family:${MONO};font-size:12px;font-weight:700;color:${tev.consecutive_cycles >= 3 ? "#dc2626" : "#111827"}">${tev.consecutive_cycles} / 3</span>`;

          return headerRow + metricRows + `<tr><td colspan="2" style="padding:9px 16px;border-top:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;background:#f9fafb">${cyclesHtml}</td></tr>`;
        })()}

        ${(() => {
          const lev = e.lsi_evidence;
          const triggered = lsiActive;
          const statusText = triggered ? "TRIGGERED" : (lev ? "NORMAL" : "NO DATA");
          const badgeColor  = triggered ? "#dc2626" : "#6b7280";
          const badgeBg     = triggered ? "#fef2f2" : "#f3f4f6";
          const badgeBorder = triggered ? "#fecaca" : "#e5e7eb";

          const headerRow = `<tr><td colspan="2" style="padding:12px 16px;border-bottom:1px solid #f3f4f6">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="font-family:${F};font-size:12px;font-weight:600;color:${triggered ? "#dc2626" : "#374151"}">
                LSI &mdash; Log Semantic Indexing
              </td>
              <td align="right">
                <span style="padding:2px 8px;border-radius:3px;font-family:${F};font-size:10px;font-weight:600;color:${badgeColor};background:${badgeBg};border:1px solid ${badgeBorder}">${statusText}</span>
              </td>
            </tr></table>
          </td></tr>`;

          if (!lev) return headerRow + `<tr><td colspan="2" style="padding:10px 16px"><span style="font-family:${F};font-size:12px;color:#9ca3af">Log data unavailable</span></td></tr>`;

          const scoreAnom = lev.is_anomalous;
          const errAnom   = lev.is_error_anomalous;
          const wc = lev.window_counts ?? {};
          const wcParts = Object.entries(wc).map(([k, v]) => {
            const isHot = (k === "ERROR" || k === "NOVEL") && (v as number) > 0;
            return `<span style="margin-right:14px;font-family:${F};font-size:12px"><span style="color:#9ca3af">${k} </span><span style="font-family:${MONO};font-weight:700;color:${isHot ? "#dc2626" : "#111827"}">${v}</span></span>`;
          }).join("");

          const recentLines = (lev.recent_lines ?? []).slice(0, 3);
          const linesHtml = recentLines.length > 0
            ? `<tr><td colspan="2" style="padding:10px 16px;border-top:1px solid #f3f4f6">
                <div style="font-family:${F};font-size:10px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">Recent log lines</div>
                <div style="background:#f9fafb;border-radius:4px;border:1px solid #e5e7eb;padding:8px 10px">
                ${recentLines.map(l => {
                  const raw = typeof l === "string" ? l : JSON.stringify(l);
                  let display = raw;
                  try {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === "object") {
                      const sev = parsed.s ?? parsed.level ?? parsed.severity ?? "";
                      const comp = parsed.c ?? parsed.component ?? "";
                      const msg = parsed.msg ?? parsed.message ?? parsed.m ?? "";
                      const ts = parsed.t?.["$date"] ?? parsed.t ?? parsed.time ?? parsed.timestamp ?? "";
                      const tsStr = ts ? new Date(ts).toISOString().replace("T"," ").slice(0,19) : "";
                      const prefix = [tsStr, sev, comp].filter(Boolean).join(" | ");
                      display = prefix ? `${prefix}: ${msg}` : (msg || raw);
                    }
                  } catch { /* not JSON */ }
                  return `<div style="font-family:${MONO};font-size:11px;color:#374151;line-height:1.7;word-break:break-all">&rsaquo; ${display.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>`;
                }).join("")}
                </div>
              </td></tr>` : "";

          return headerRow
            + `<tr>
                <td width="100" style="padding:9px 16px;font-family:${F};font-size:12px;color:#6b7280;border-bottom:1px solid #f3f4f6">Anomaly score</td>
                <td style="padding:9px 16px 9px 0;border-bottom:1px solid #f3f4f6">
                  <span style="font-family:${MONO};font-size:12px;font-weight:700;color:${scoreAnom ? "#dc2626" : "#111827"}">${lev.current_score.toFixed(4)}</span>
                  <span style="font-family:${MONO};font-size:11px;color:#9ca3af;margin-left:8px">baseline ${lev.baseline_mean.toFixed(4)}</span>
                  <span style="font-family:${MONO};font-size:11px;color:#9ca3af;margin-left:6px">threshold ${lev.threshold.toFixed(4)}</span>
                  ${scoreAnom ? `<span style="font-family:${F};font-size:10px;font-weight:600;color:#dc2626;margin-left:8px">EXCEEDED</span>` : ""}
                </td>
              </tr>
              <tr>
                <td style="padding:9px 16px;font-family:${F};font-size:12px;color:#6b7280${wcParts || linesHtml ? ";border-bottom:1px solid #f3f4f6" : ""}">Error score</td>
                <td style="padding:9px 16px 9px 0${wcParts || linesHtml ? ";border-bottom:1px solid #f3f4f6" : ""}">
                  <span style="font-family:${MONO};font-size:12px;font-weight:700;color:${errAnom ? "#dc2626" : "#111827"}">${lev.error_score.toFixed(4)}</span>
                  <span style="font-family:${MONO};font-size:11px;color:#9ca3af;margin-left:8px">threshold ${lev.error_threshold.toFixed(4)}</span>
                  ${errAnom ? `<span style="font-family:${F};font-size:10px;font-weight:600;color:#dc2626;margin-left:8px">EXCEEDED</span>` : ""}
                </td>
              </tr>`
            + (wcParts ? `<tr><td colspan="2" style="padding:9px 16px;border-top:1px solid #f3f4f6${linesHtml ? ";border-bottom:1px solid #f3f4f6" : ""}">${wcParts}</td></tr>` : "")
            + linesHtml;
        })()}

      </table>
    </td></tr>

    <!-- Timeline -->
    <tr><td style="padding:20px 28px;border-bottom:1px solid #f3f4f6">
      <p style="margin:0 0 10px;font-family:${F};font-size:10px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase">Recovery Timeline</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${timelineRow(`<span style="font-size:14px;line-height:30px">&#9888;</span>`, "#fffbeb", "Anomaly detected",   e.anomaly_detected_at)}
        ${timelineRow(`<span style="font-size:14px;line-height:30px">&#8635;</span>`, "#eef2ff", "Rollback triggered", e.triggered_at)}
        ${timelineRow(`<span style="font-size:14px;line-height:30px;color:${success ? "#16a34a" : "#dc2626"}">${success ? "&#10003;" : "&#10005;"}</span>`, success ? "#f0fdf4" : "#fef2f2", success ? "Recovery complete" : "Rollback failed", e.rollback_completed_at)}
      </table>
    </td></tr>

    <!-- Incident message -->
    <tr><td style="padding:20px 28px;border-bottom:1px solid #f3f4f6">
      <p style="margin:0 0 10px;font-family:${F};font-size:10px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase">Incident Details</p>
      <p style="margin:0;font-family:${F};font-size:13px;color:#374151;line-height:1.7;background:#f9fafb;padding:12px 16px;border-radius:6px;border:1px solid #e5e7eb">${e.message}</p>
    </td></tr>

    <!-- Next steps -->
    <tr><td style="padding:20px 28px">
      <p style="margin:0 0 12px;font-family:${F};font-size:10px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase">Recommended Next Steps</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        ${nextSteps.map((step, i) => `
        <tr>
          <td width="32" style="padding:6px 0;vertical-align:top">
            <span style="display:inline-block;width:22px;height:22px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:50%;text-align:center;line-height:22px;font-family:${F};font-size:11px;font-weight:700;color:#7c3aed">${i + 1}</span>
          </td>
          <td style="padding:6px 0 6px 8px;font-family:${F};font-size:13px;color:#374151;line-height:1.65;vertical-align:middle">${step}</td>
        </tr>`).join("")}
      </table>
    </td></tr>

  </table>`;

  const preheader = success
    ? `Rollback succeeded for ${e.service}${mttr ? ` — recovered in ${mttr}` : ""}`
    : `Action required: rollback FAILED for ${e.service} — immediate attention needed`;

  return emailWrapper(preheader, card);
}
