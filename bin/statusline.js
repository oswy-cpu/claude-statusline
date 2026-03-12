#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

// ── Colors ──────────────────────────────────────────────
const blue = "\x1b[38;2;0;153;255m";
const orange = "\x1b[38;2;255;176;85m";
const green = "\x1b[38;2;0;175;80m";
const cyan = "\x1b[38;2;86;182;194m";
const red = "\x1b[38;2;255;85;85m";
const yellow = "\x1b[38;2;230;200;0m";
const white = "\x1b[38;2;220;220;220m";
const magenta = "\x1b[38;2;180;140;255m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

const sep = ` ${dim}│${reset} `;

// ── Helpers ─────────────────────────────────────────────
function formatTokens(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "m";
  if (num >= 1000) return Math.round(num / 1000) + "k";
  return String(num);
}

function colorForPct(pct) {
  if (pct >= 90) return red;
  if (pct >= 70) return yellow;
  if (pct >= 50) return orange;
  return green;
}

function buildBar(pct, width) {
  pct = Math.max(0, Math.min(100, pct));
  const filled = Math.round((pct * width) / 100);
  const empty = width - filled;
  const barColor = colorForPct(pct);
  return `${barColor}${"●".repeat(filled)}${dim}${"○".repeat(empty)}${reset}`;
}

function isoToEpoch(isoStr) {
  if (!isoStr || isoStr === "null") return null;
  const d = new Date(isoStr);
  return isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

function formatResetTime(isoStr, style) {
  if (!isoStr || isoStr === "null") return "";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return "";

  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];

  if (style === "time") {
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `${h}:${m}${ampm}`;
  }
  if (style === "datetime") {
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `${months[d.getMonth()]} ${d.getDate()}, ${h}:${m}${ampm}`;
  }
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function execSilent(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

// ── OAuth token resolution ──────────────────────────────
function getOAuthToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }

  // macOS Keychain
  if (process.platform === "darwin") {
    const blob = execSilent(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null'
    );
    if (blob) {
      try {
        const token = JSON.parse(blob)?.claudeAiOauth?.accessToken;
        if (token) return token;
      } catch {}
    }
  }

  // Credentials file
  const credsFile = path.join(os.homedir(), ".claude", ".credentials.json");
  if (fs.existsSync(credsFile)) {
    try {
      const token = JSON.parse(fs.readFileSync(credsFile, "utf-8"))?.claudeAiOauth?.accessToken;
      if (token) return token;
    } catch {}
  }

  // Windows credential manager
  if (process.platform === "win32") {
    try {
      const result = execSilent(
        'powershell -NoProfile -Command "[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Get-StoredCredential -Target \'Claude Code-credentials\').Password))"'
      );
      if (result) {
        const token = JSON.parse(result)?.claudeAiOauth?.accessToken;
        if (token) return token;
      }
    } catch {}
  }

  // Linux secret-tool
  if (process.platform === "linux") {
    const blob = execSilent(
      'timeout 2 secret-tool lookup service "Claude Code-credentials" 2>/dev/null'
    );
    if (blob) {
      try {
        const token = JSON.parse(blob)?.claudeAiOauth?.accessToken;
        if (token) return token;
      } catch {}
    }
  }

  return "";
}

// ── Fetch usage data with caching ───────────────────────
function getCacheDir() {
  if (process.platform === "win32") {
    return path.join(os.tmpdir(), "claude");
  }
  return "/tmp/claude";
}

function fetchUsageData() {
  const cacheDir = getCacheDir();
  const cacheFile = path.join(cacheDir, "statusline-usage-cache.json");
  const cacheMaxAge = 60;

  let needsRefresh = true;
  let usageData = "";

  if (fs.existsSync(cacheFile)) {
    try {
      const stat = fs.statSync(cacheFile);
      const ageSeconds = (Date.now() - stat.mtimeMs) / 1000;
      if (ageSeconds < cacheMaxAge) {
        needsRefresh = false;
        usageData = fs.readFileSync(cacheFile, "utf-8");
      }
    } catch {}
  }

  if (needsRefresh) {
    const token = getOAuthToken();
    if (token) {
      try {
        const response = execSilent(
          `curl -s --max-time 5 -H "Accept: application/json" -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -H "anthropic-beta: oauth-2025-04-20" -H "User-Agent: claude-code/2.1.34" "https://api.anthropic.com/api/oauth/usage"`
        );
        if (response) {
          const parsed = JSON.parse(response);
          if (parsed.five_hour) {
            usageData = response;
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(cacheFile, response);
          }
        }
      } catch {}
    }
    if (!usageData && fs.existsSync(cacheFile)) {
      try {
        usageData = fs.readFileSync(cacheFile, "utf-8");
      } catch {}
    }
  }

  if (!usageData) return null;
  try {
    return JSON.parse(usageData);
  } catch {
    return null;
  }
}

// ── Main ────────────────────────────────────────────────
function main() {
  let rawInput = "";
  try {
    rawInput = fs.readFileSync(0, "utf-8");
  } catch {}

  if (!rawInput.trim()) {
    process.stdout.write("Claude");
    return;
  }

  let input;
  try {
    input = JSON.parse(rawInput);
  } catch {
    process.stdout.write("Claude");
    return;
  }

  // ── Extract JSON data ───────────────────────────────
  const modelName = input?.model?.display_name || "Claude";
  let size = input?.context_window?.context_window_size || 200000;
  if (size === 0) size = 200000;

  const inputTokens = input?.context_window?.current_usage?.input_tokens || 0;
  const cacheCreate =
    input?.context_window?.current_usage?.cache_creation_input_tokens || 0;
  const cacheRead =
    input?.context_window?.current_usage?.cache_read_input_tokens || 0;
  const current = inputTokens + cacheCreate + cacheRead;

  const pctUsed = size > 0 ? Math.round((current * 100) / size) : 0;

  // Effort level
  let effort = "default";
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      effort = settings.effortLevel || "default";
    } catch {}
  }

  // ── LINE 1 ──────────────────────────────────────────
  const pctColor = colorForPct(pctUsed);
  let cwd = input?.cwd || process.cwd();
  const dirname = path.basename(cwd);

  let gitBranch = "";
  let gitDirty = "";
  try {
    execSync(`git -C "${cwd}" rev-parse --is-inside-work-tree`, {
      stdio: "ignore",
    });
    gitBranch = execSilent(`git -C "${cwd}" symbolic-ref --short HEAD`);
    const porcelain = execSilent(`git -C "${cwd}" status --porcelain`);
    if (porcelain) gitDirty = "*";
  } catch {}

  let sessionDuration = "";
  const sessionStart = input?.session?.start_time;
  if (sessionStart) {
    const startEpoch = isoToEpoch(sessionStart);
    if (startEpoch) {
      const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - startEpoch);
      if (elapsed >= 3600) {
        sessionDuration = `${Math.floor(elapsed / 3600)}h${Math.floor((elapsed % 3600) / 60)}m`;
      } else if (elapsed >= 60) {
        sessionDuration = `${Math.floor(elapsed / 60)}m`;
      } else {
        sessionDuration = `${elapsed}s`;
      }
    }
  }

  let line1 = `${blue}${modelName}${reset}`;
  line1 += sep;
  line1 += `✍️ ${pctColor}${pctUsed}%${reset}`;
  line1 += sep;
  line1 += `${cyan}${dirname}${reset}`;
  if (gitBranch) {
    line1 += ` ${green}(${gitBranch}${red}${gitDirty}${green})${reset}`;
  }
  if (sessionDuration) {
    line1 += sep;
    line1 += `${dim}⏱ ${reset}${white}${sessionDuration}${reset}`;
  }
  line1 += sep;
  switch (effort) {
    case "high":
      line1 += `${magenta}● ${effort}${reset}`;
      break;
    case "low":
      line1 += `${dim}◔ ${effort}${reset}`;
      break;
    default:
      line1 += `${dim}◑ ${effort}${reset}`;
      break;
  }

  // ── Rate limit lines ────────────────────────────────
  let rateLines = "";
  const usageData = fetchUsageData();

  if (usageData) {
    const barWidth = 10;

    // Five hour
    const fiveHourPct = Math.round(usageData.five_hour?.utilization || 0);
    const fiveHourResetIso = usageData.five_hour?.resets_at;
    const fiveHourReset = formatResetTime(fiveHourResetIso, "time");
    const fiveHourBar = buildBar(fiveHourPct, barWidth);
    const fiveHourPctColor = colorForPct(fiveHourPct);
    const fiveHourPctFmt = String(fiveHourPct).padStart(3);

    rateLines += `${white}current${reset} ${fiveHourBar} ${fiveHourPctColor}${fiveHourPctFmt}%${reset} ${dim}⟳${reset} ${white}${fiveHourReset}${reset}`;

    // Seven day
    const sevenDayPct = Math.round(usageData.seven_day?.utilization || 0);
    const sevenDayResetIso = usageData.seven_day?.resets_at;
    const sevenDayReset = formatResetTime(sevenDayResetIso, "datetime");
    const sevenDayBar = buildBar(sevenDayPct, barWidth);
    const sevenDayPctColor = colorForPct(sevenDayPct);
    const sevenDayPctFmt = String(sevenDayPct).padStart(3);

    rateLines += `\n${white}weekly${reset}  ${sevenDayBar} ${sevenDayPctColor}${sevenDayPctFmt}%${reset} ${dim}⟳${reset} ${white}${sevenDayReset}${reset}`;

    // Extra usage
    if (usageData.extra_usage?.is_enabled) {
      const extraPct = Math.round(usageData.extra_usage?.utilization || 0);
      const extraUsed = ((usageData.extra_usage?.used_credits || 0) / 100).toFixed(2);
      const extraLimit = ((usageData.extra_usage?.monthly_limit || 0) / 100).toFixed(2);
      const extraBar = buildBar(extraPct, barWidth);
      const extraPctColor = colorForPct(extraPct);

      // Next month's 1st
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const extraReset = `${months[nextMonth.getMonth()]} ${nextMonth.getDate()}`;

      rateLines += `\n${white}extra${reset}   ${extraBar} ${extraPctColor}$${extraUsed}${dim}/${reset}${white}$${extraLimit}${reset} ${dim}⟳${reset} ${white}${extraReset}${reset}`;
    }
  }

  // ── Output ──────────────────────────────────────────
  process.stdout.write(line1);
  if (rateLines) {
    process.stdout.write(`\n\n${rateLines}`);
  }
}

main();
