#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");
const STATUSLINE_DEST = path.join(CLAUDE_DIR, "statusline.js");
const STATUSLINE_SRC = path.resolve(__dirname, "statusline.js");

const blue = "\x1b[38;2;0;153;255m";
const green = "\x1b[38;2;0;175;80m";
const red = "\x1b[38;2;255;85;85m";
const yellow = "\x1b[38;2;230;200;0m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

function log(msg) {
  console.log(`  ${msg}`);
}

function success(msg) {
  console.log(`  ${green}✓${reset} ${msg}`);
}

function warn(msg) {
  console.log(`  ${yellow}!${reset} ${msg}`);
}

function fail(msg) {
  console.error(`  ${red}✗${reset} ${msg}`);
}

function checkDeps() {
  const { execSync } = require("child_process");
  const missing = [];

  // git and curl are the only external deps now (jq is no longer needed)
  for (const dep of ["curl", "git"]) {
    try {
      const cmd = process.platform === "win32" ? `where ${dep}` : `which ${dep}`;
      execSync(cmd, { stdio: "ignore" });
    } catch {
      missing.push(dep);
    }
  }

  return missing;
}

function uninstall() {
  console.log();
  console.log(`  ${blue}Claude Line Uninstaller${reset}`);
  console.log(`  ${dim}───────────────────────${reset}`);
  console.log();

  const backup = STATUSLINE_DEST + ".bak";

  // Also clean up old .sh file if present
  const oldShFile = path.join(CLAUDE_DIR, "statusline.sh");
  if (fs.existsSync(oldShFile)) {
    fs.unlinkSync(oldShFile);
    success(`Removed old ${dim}statusline.sh${reset}`);
  }
  const oldShBak = oldShFile + ".bak";
  if (fs.existsSync(oldShBak)) {
    fs.unlinkSync(oldShBak);
  }

  if (fs.existsSync(backup)) {
    fs.copyFileSync(backup, STATUSLINE_DEST);
    fs.unlinkSync(backup);
    success(`Restored previous statusline from ${dim}statusline.js.bak${reset}`);
  } else if (fs.existsSync(STATUSLINE_DEST)) {
    fs.unlinkSync(STATUSLINE_DEST);
    success(`Removed ${dim}statusline.js${reset}`);
  } else {
    warn("No statusline found — nothing to remove");
  }

  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      if (settings.statusLine) {
        delete settings.statusLine;
        fs.writeFileSync(
          SETTINGS_FILE,
          JSON.stringify(settings, null, 2) + "\n"
        );
        success(`Removed statusLine from ${dim}settings.json${reset}`);
      } else {
        success("Settings already clean");
      }
    } catch {
      fail(`Could not parse ${SETTINGS_FILE} — fix it manually`);
      process.exit(1);
    }
  }

  console.log();
  log(`${green}Done!${reset} Restart Claude Code to apply changes.`);
  console.log();
}

function run() {
  if (process.argv.includes("--uninstall")) {
    uninstall();
    return;
  }

  console.log();
  console.log(`  ${blue}Claude Line Installer${reset}`);
  console.log(`  ${dim}─────────────────────${reset}`);
  console.log();

  const missing = checkDeps();
  if (missing.length > 0) {
    fail(`Missing required dependencies: ${missing.join(", ")}`);
    log(`  Install them and try again.`);
    process.exit(1);
  }
  success("Dependencies found (curl, git)");

  if (!fs.existsSync(CLAUDE_DIR)) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    success(`Created ${CLAUDE_DIR}`);
  }

  const backup = STATUSLINE_DEST + ".bak";
  if (fs.existsSync(STATUSLINE_DEST)) {
    fs.copyFileSync(STATUSLINE_DEST, backup);
    warn(
      `Backed up existing statusline to ${dim}statusline.js.bak${reset}`
    );
  }

  fs.copyFileSync(STATUSLINE_SRC, STATUSLINE_DEST);
  if (process.platform !== "win32") {
    fs.chmodSync(STATUSLINE_DEST, 0o755);
  }
  success(`Installed statusline to ${dim}${STATUSLINE_DEST}${reset}`);

  // Clean up old .sh file from previous versions
  const oldShFile = path.join(CLAUDE_DIR, "statusline.sh");
  if (fs.existsSync(oldShFile)) {
    fs.unlinkSync(oldShFile);
    success(`Removed old ${dim}statusline.sh${reset} (migrated to Node.js)`);
  }

  let settings = {};
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    } catch {
      fail(`Could not parse ${SETTINGS_FILE} — fix it manually`);
      process.exit(1);
    }
  }

  // Use node to run the script — works on all platforms
  const statuslinePath = path.join(os.homedir(), ".claude", "statusline.js").replace(/\\/g, "/");
  const statusLineConfig = {
    type: "command",
    command: `node "${statuslinePath}"`,
  };

  if (
    settings.statusLine &&
    settings.statusLine.type === "command" &&
    settings.statusLine.command === statusLineConfig.command
  ) {
    success("Settings already configured");
  } else {
    settings.statusLine = statusLineConfig;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n");
    success(`Updated ${dim}settings.json${reset} with statusLine config`);
  }

  console.log();
  log(`${green}Done!${reset} Restart Claude Code to see your new status line.`);
  console.log();
}

run();
