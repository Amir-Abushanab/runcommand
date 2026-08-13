#!/usr/bin/env node
/**
 * runcommand — show each project's run command in the Claude Code status bar.
 *
 * It figures out the single "how do I start this project" command with a quick
 * `claude -p` call, caches the answer per-project, and only re-asks when the
 * project's manifest actually changes. The status-line path never blocks on the
 * model: on a cache miss it kicks detection off in the background and shows a
 * placeholder until the answer lands.
 *
 * Standalone and dependency-free (Node built-ins only). Coexists with any other
 * status-line tool via RUNCOMMAND_BASE (see `statusline` below) — it never
 * assumes or touches another tool's config.
 *
 * Subcommands:
 *   statusline      render the run-command line (called by Claude Code, stdin=JSON)
 *   detect [dir]    (re)detect now, synchronously; print + cache the command
 *   get [dir]       print the cached command (detect synchronously if missing)
 *   refresh [dir]   drop the cache for a project and detect again
 *   path [dir]      print the cache file path for a project
 *   help            usage
 *
 * Flags: -C/--project <dir>, --model <id>, --quiet
 * Env:   RUNCOMMAND_MODEL, RUNCOMMAND_BASE, RUNCOMMAND_ICON, RUNCOMMAND_LABEL,
 *        RUNCOMMAND_TTL_MS, NO_COLOR
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const MODEL = process.env.RUNCOMMAND_MODEL || "haiku";
const ICON = process.env.RUNCOMMAND_ICON ?? "▶";
const LABEL = process.env.RUNCOMMAND_LABEL ?? ""; // e.g. "run: "
const DETECT_TIMEOUT_MS = 90_000;
const LOCK_STALE_MS = 3 * 60_000;
// A confirmed answer stays put until the manifest changes. This TTL only
// re-checks projects whose files we couldn't hash (edge cases); default off.
const TTL_MS = Number(process.env.RUNCOMMAND_TTL_MS || 0);

const CACHE_DIR = path.join(
  process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
  "runcommand",
);

// Files that mark a project root and/or feed detection. Order is priority for
// "nearest root" resolution — .git and package.json win.
const ROOT_MARKERS = [".git", "package.json"];
const MANIFESTS = [
  "package.json", "deno.json", "deno.jsonc",
  "Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt", "manage.py",
  "setup.py", "Pipfile", "Makefile", "Justfile", "justfile", "Taskfile.yml",
  "Procfile", "Gemfile", "mix.exs", "pom.xml", "build.gradle",
  "build.gradle.kts", "CMakeLists.txt", "composer.json",
  "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
  "index.html", "main.py", "app.py",
];
const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["deno.lock", "deno"],
];
const OVERRIDE_FILES = [".claude-run", ".runcommand"];
// Manifests whose *contents* define the run command — hash their contents so
// editing a Makefile target, a compose service, Cargo/pyproject, etc. triggers
// an automatic re-detect (presence alone isn't enough for these).
const CMD_MANIFESTS = [
  "Makefile", "Justfile", "justfile", "Taskfile.yml", "Procfile",
  "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
  "Cargo.toml", "pyproject.toml", "composer.json", "mix.exs", "Gemfile",
  "deno.json", "deno.jsonc",
];

// ---------- small utils ----------

const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

function stripAnsiSafeLog(...args) {
  if (!QUIET) console.error("[runcommand]", ...args);
}
let QUIET = false;

function color(s, code) {
  if (process.env.NO_COLOR || !process.stdout.isTTY && !FORCE_COLOR) {
    // Status lines are captured (not a TTY) but Claude Code renders ANSI, so
    // we still emit color unless NO_COLOR is set.
  }
  if (process.env.NO_COLOR) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}
const FORCE_COLOR = true;
const dim = (s) => color(s, "2");
const cyan = (s) => color(s, "36");
// Per-service palette, cycled by position. Default is colorblind-safe (cyan,
// amber, magenta, blue, green — no red/green pairing). A single command keeps
// cyan. Override with RUNCOMMAND_COLORS="36,33,35" (comma-separated ANSI codes).
const PALETTE = (process.env.RUNCOMMAND_COLORS || "36,33,35,34,32")
  .split(",").map((s) => s.trim()).filter(Boolean);
const paletteColor = (s, i) => color(s, PALETTE[i % PALETTE.length] || "36");

// ---------- project resolution ----------

function findProjectRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  let nearestManifest = null;
  let nearestGit = null;
  // Walk up to filesystem root.
  for (;;) {
    if (!nearestGit && exists(path.join(dir, ".git"))) nearestGit = dir;
    if (!nearestManifest && exists(path.join(dir, "package.json"))) nearestManifest = dir;
    if (!nearestManifest) {
      for (const m of MANIFESTS) {
        if (exists(path.join(dir, m))) { nearestManifest = dir; break; }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Prefer the nearest package.json/manifest (handles monorepo subpackages),
  // then a git root, then the starting dir.
  return nearestManifest || nearestGit || path.resolve(startDir || process.cwd());
}

function detectPM(root, pkg) {
  const field = pkg && typeof pkg.packageManager === "string" ? pkg.packageManager : null;
  if (field) {
    const name = field.split("@")[0].trim();
    if (name) return name;
  }
  for (const [file, pm] of LOCKFILES) {
    if (exists(path.join(root, file))) return pm;
  }
  if (pkg) return "npm"; // has package.json but no lock/field
  return null;
}

// ---------- signals & override ----------

function listManifests(root) {
  let entries = [];
  try { entries = fs.readdirSync(root); } catch { return []; }
  const set = new Set(entries);
  return MANIFESTS.filter((m) => set.has(m));
}

// Strip fenced code blocks so a documentation example ("Run: ..." shown inside
// ``` fences) is never mistaken for a real directive.
function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
}

// An authoritative "Run: <command>" directive — ONLY from CLAUDE.md (READMEs are
// full of command examples) and only outside code fences.
function readRunDirective(root) {
  const txt = readText(path.join(root, "CLAUDE.md"));
  if (!txt) return null;
  const m = stripFences(txt).match(/^[ \t]*(?:#+[ \t]*|<!--[ \t]*)?run[ \t]*:[ \t]*(.+?)[ \t]*(?:-->)?[ \t]*$/im);
  return m ? { command: m[1].trim(), file: "CLAUDE.md" } : null;
}

// Advisory only: hand the model the first "getting started"-ish code block as a
// hint. Never authoritative — it just gives detection more to go on.
function readRunHint(root) {
  for (const name of ["README.md", "readme.md", "Readme.md", "CLAUDE.md"]) {
    const txt = readText(path.join(root, name));
    if (!txt) continue;
    const block = txt.match(/```(?:[a-z]*)\n([\s\S]{0,400}?)```/i);
    if (block) return { hint: block[1].trim().slice(0, 400), file: name };
  }
  return null;
}

// "label: command" (colon then space) is a labeled service; anything else is a
// bare command. The space requirement keeps "pnpm dev:web" from splitting.
function parseOverrideLine(line) {
  const m = line.match(/^([\w.\-/ ]{1,24}):\s+(.+)$/);
  return m ? { label: m[1].trim(), command: m[2].trim() } : { command: line };
}

function readOverride(root) {
  for (const name of OVERRIDE_FILES) {
    const txt = readText(path.join(root, name));
    if (txt == null) continue;
    const commands = [];
    for (const raw of txt.split("\n")) {
      const line = raw.trim();
      if (line && !line.startsWith("#")) commands.push(parseOverrideLine(line));
    }
    if (commands.length) return { commands, file: name };
  }
  const dir = readRunDirective(root);
  if (dir) return { commands: [parseOverrideLine(dir.command)], file: dir.file };
  return null;
}

function collectSignals(root) {
  const pkg = readJson(path.join(root, "package.json"));
  const pm = detectPM(root, pkg);
  const manifests = listManifests(root);
  const hint = readRunHint(root);
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : null;
  return { root, basename: path.basename(root), pkg, pm, manifests, hint, scripts };
}

// Hash the bits that should trigger a re-detect when they change. Cheap enough
// to compute on every status-line render.
function signalsHash(root) {
  const parts = [];
  const pkgTxt = readText(path.join(root, "package.json"));
  if (pkgTxt) {
    const pkg = readJson(path.join(root, "package.json")) || {};
    parts.push("scripts:" + JSON.stringify(pkg.scripts || {}));
    parts.push("pm:" + (pkg.packageManager || ""));
  }
  parts.push("manifests:" + listManifests(root).join(","));
  for (const [file] of LOCKFILES) if (exists(path.join(root, file))) parts.push("lock:" + file);
  for (const f of OVERRIDE_FILES) { const t = readText(path.join(root, f)); if (t != null) parts.push(f + ":" + t); }
  // Contents of command-defining manifests (small files; cheap to hash) so that
  // editing a Makefile target, a compose service, Cargo/pyproject, etc. invalidates.
  for (const f of CMD_MANIFESTS) { const t = readText(path.join(root, f)); if (t != null) parts.push(f + ":" + sha1(t)); }
  // A "Run:" directive in CLAUDE.md (outside code fences) should re-detect too.
  const dir = readRunDirective(root);
  if (dir) parts.push("run-directive:" + dir.command);
  return sha1(parts.join(" "));
}

// ---------- cache ----------

function cachePathFor(root) {
  return path.join(CACHE_DIR, sha1(path.resolve(root)) + ".json");
}
function loadCache(root) { return readJson(cachePathFor(root)); }
function saveCache(root, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const p = cachePathFor(root);
    const tmp = p + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ root, ...data }, null, 2));
    fs.renameSync(tmp, p);
  } catch (e) { stripAnsiSafeLog("cache write failed:", e.message); }
}

function lockPathFor(root) { return path.join(CACHE_DIR, sha1(path.resolve(root)) + ".lock"); }
function detectInFlight(root) {
  const lp = lockPathFor(root);
  try {
    const st = fs.statSync(lp);
    if (Date.now() - st.mtimeMs < LOCK_STALE_MS) return true;
    fs.unlinkSync(lp); // stale
  } catch { /* no lock */ }
  return false;
}
function acquireLock(root) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(lockPathFor(root), String(process.pid), { flag: "wx" }); return true; }
  catch {
    if (!detectInFlight(root)) { try { fs.writeFileSync(lockPathFor(root), String(process.pid)); return true; } catch {} }
    return false;
  }
}
function releaseLock(root) { try { fs.unlinkSync(lockPathFor(root)); } catch {} }

// ---------- detection (the model call) ----------

function buildPrompt(sig, note) {
  const scripts = sig.scripts
    ? JSON.stringify(sig.scripts, null, 1).slice(0, 3500)
    : (sig.pkg ? "(package.json has no scripts)" : "(no package.json)");
  const readmeHint = sig.hint ? sig.hint.hint.slice(0, 400) : "(none)";
  const lines = [
    "You determine how a developer starts THIS project for local development",
    '(its "dev"/"run" command).',
    "",
    "Answer with the command(s) inside <cmd></cmd> tags:",
    "- Usually ONE command: e.g. <cmd>pnpm dev</cmd>.",
    "- Only if the repo runs SEVERAL distinct long-running services in parallel",
    "  (e.g. a web app AND a separate API/backend/worker), return one tagged",
    '  command each: <cmd label="web">pnpm dev:web</cmd> <cmd label="api">pnpm dev:api</cmd>.',
    "  Do NOT split one app into build/lint/test steps — only genuine services.",
    `- Use this package manager for JS/TS projects: ${sig.pm || "unknown"}.`,
    '- Prefer a dev server (like "<pm> dev") over build/start/preview when several exist.',
    "- A docker-compose file is usually for backing services (db, cache, queue), NOT",
    "  the app itself. Only answer 'docker compose up' when there is no package.json",
    "  dev script and no other app-level run command.",
    "- For non-JS projects use the idiomatic command (cargo run, go run ., ",
    "  python manage.py runserver, make dev, docker compose up, etc.).",
    "- If there is genuinely no run/dev step (a pure library), answer <cmd>none</cmd>.",
    "",
    `Project: ${sig.basename}`,
    `Package manager: ${sig.pm || "unknown"}`,
    `Manifest/config files present: ${sig.manifests.join(", ") || "(none)"}`,
    "package.json scripts:",
    scripts,
    "Run hint from README/CLAUDE.md (may be empty):",
    readmeHint,
  ];
  if (note && note.trim()) {
    lines.push(
      "",
      "IMPORTANT — the developer says the previous guess was WRONG. Their correction",
      "(honor it; it overrides the preferences above):",
      note.trim(),
    );
  }
  return lines.join("\n");
}

function cleanCmd(s) {
  let cmd = (s || "").trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  cmd = cmd.replace(/<\/?cmd[^>]*>/gi, "").trim(); // strip stray <cmd> tags
  cmd = cmd.replace(/^[`'"]|[`'"]$/g, "").replace(/^\$\s*/, "").replace(/^>\s*/, "").trim();
  if (!cmd || /^none$/i.test(cmd) || /^\(none\)$/i.test(cmd)) return "";
  return cmd.split("\n")[0].slice(0, 200).trim();
}

// Parse the model's answer into [{label?, command}]. Multiple <cmd> tags => a
// service each; a bare last line is tolerated as a single unlabeled command.
function parseCommands(stdout) {
  if (!stdout) return [];
  const out = [];
  let sawTag = false;
  const re = /<cmd(?:\s+label=["']([^"']*)["'])?\s*>([\s\S]*?)<\/cmd>/gi;
  let m;
  while ((m = re.exec(stdout)) !== null) {
    sawTag = true;
    const command = cleanCmd(m[2]);
    if (!command) continue;
    const label = (m[1] || "").trim();
    out.push(label ? { label, command } : { command });
  }
  // Only fall back to a bare last line if the model emitted NO tags at all —
  // otherwise a clean <cmd>none</cmd> would get mis-parsed back into a command.
  if (out.length === 0 && !sawTag) {
    const last = stdout.split("\n").map((l) => l.trim()).filter(Boolean).pop() || "";
    const command = cleanCmd(last);
    if (command) out.push({ command });
  }
  return out.slice(0, 4);
}

// Old caches stored a single `command` string; new ones store a `commands` array.
function normalizeCommands(src) {
  if (!src) return [];
  if (Array.isArray(src.commands)) return src.commands.filter((c) => c && c.command);
  if (typeof src.command === "string" && src.command) return [{ command: src.command }];
  return [];
}

function formatCommandsCLI(commands) {
  const cmds = (commands || []).filter((c) => c && c.command);
  if (!cmds.length) return "(no run command)";
  return cmds.map((c) => (c.label ? c.label + ": " : "") + c.command).join("\n");
}

// Resolve the claude CLI without depending on the status line's PATH (which can
// be minimal). Checks RUNCOMMAND_CLAUDE, then common install locations.
let CLAUDE_BIN = null;
function claudeBin() {
  if (CLAUDE_BIN) return CLAUDE_BIN;
  const candidates = [
    process.env.RUNCOMMAND_CLAUDE,
    path.join(os.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(os.homedir(), ".claude/local/claude"),
  ].filter(Boolean);
  for (const c of candidates) if (exists(c)) return (CLAUDE_BIN = c);
  return (CLAUDE_BIN = "claude"); // last resort: rely on PATH
}

function detect(root, { quiet = false, note, clearNote = false } = {}) {
  QUIET = quiet;
  const hash = signalsHash(root);
  const prev = loadCache(root);
  const storedNote = prev && typeof prev.note === "string" ? prev.note : "";
  // A correction sticks with the project so later auto-redetects don't regress
  // to the wrong answer. A new non-empty note replaces it; --clear-hint wipes it.
  const activeNote = clearNote ? "" : (note && note.trim() ? note.trim() : storedNote);
  const override = readOverride(root);
  if (override) {
    saveCache(root, { commands: override.commands, source: "override", via: override.file, note: activeNote, signalsHash: hash, detectedAt: Date.now() });
    return { commands: override.commands, source: "override" };
  }
  const sig = collectSignals(root);
  if (!sig.pkg && sig.manifests.length === 0) {
    saveCache(root, { commands: [], source: "empty", note: activeNote, signalsHash: hash, detectedAt: Date.now() });
    return { commands: [], source: "empty" };
  }
  const prompt = buildPrompt(sig, activeNote);
  const model = ARGS.model || MODEL;
  // Run in the target root so any ambient project context claude loads belongs
  // to THIS project — not the dir the status line happened to be invoked from.
  const res = spawnSync(claudeBin(), ["-p", prompt, "--model", model], {
    cwd: root, encoding: "utf8", timeout: DETECT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) {
    stripAnsiSafeLog("claude -p failed:", res.error ? res.error.message : (res.stderr || "").trim().slice(0, 200));
    // Keep any previous answer; don't poison the cache.
    return prev ? { commands: normalizeCommands(prev), source: prev.source } : null;
  }
  const commands = parseCommands(res.stdout);
  saveCache(root, { commands, source: "llm", model, note: activeNote, signalsHash: hash, detectedAt: Date.now() });
  return { commands, source: "llm" };
}

// ---------- background trigger ----------

function triggerBackgroundDetect(root) {
  // Take the lock HERE, before spawning, so the next render (300ms later) already
  // sees "in flight" and won't spawn a second detect. The child runs with
  // --locked (it won't re-acquire) and releases the lock when it finishes.
  // Without this, every render spawns another claude -p — a runaway.
  if (!acquireLock(root)) return;
  try {
    const child = spawn(process.execPath, [SELF, "detect", "--project", root, "--quiet", "--locked"], {
      detached: true, stdio: "ignore",
    });
    child.unref();
  } catch (e) { releaseLock(root); stripAnsiSafeLog("bg spawn failed:", e.message); }
}

// ---------- localhost ports (scoped to the project) ----------

const PORTS_TTL_MS = Number(process.env.RUNCOMMAND_PORTS_TTL_MS || 2500);
const LOCAL_ADDR = /(?:\*|0\.0\.0\.0|127\.0\.0\.1|\[?::1?\]?|\[::\]):(\d+)$/;
// Drop OS dynamic/ephemeral ports (workerd internals, IPC) and debuggers so we
// show the actual dev server, not its plumbing.
const EPHEMERAL_MIN = 49152;
const IGNORE_PORTS = new Set((process.env.RUNCOMMAND_IGNORE_PORTS || "9229,9230").split(",").map(Number).filter(Boolean));
const keepPort = (p) => p > 0 && p < EPHEMERAL_MIN && !IGNORE_PORTS.has(p);

function lsofFields(args) {
  try {
    const res = spawnSync("lsof", args, { encoding: "utf8", timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
    return res.stdout || "";
  } catch { return ""; }
}

// [{pid, port}] for localhost / wildcard TCP listeners.
function scanListeners() {
  const out = [];
  let pid = null;
  for (const line of lsofFields(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]).split("\n")) {
    if (!line) continue;
    const tag = line[0], val = line.slice(1);
    if (tag === "p") pid = Number(val);
    else if (tag === "n" && pid != null) {
      const m = val.match(LOCAL_ADDR);
      if (m) out.push({ pid, port: Number(m[1]) });
    }
  }
  return out;
}

// One lsof call maps every listener PID to its working directory.
function cwdsFor(pids) {
  const map = {};
  if (!pids.length) return map;
  let pid = null;
  for (const line of lsofFields(["-a", "-d", "cwd", "-p", pids.join(","), "-Fpn"]).split("\n")) {
    if (!line) continue;
    const tag = line[0], val = line.slice(1);
    if (tag === "p") pid = Number(val);
    else if (tag === "n" && pid != null) map[pid] = val;
  }
  return map;
}

function computePorts(root, all) {
  const listeners = scanListeners().filter((l) => keepPort(l.port));
  if (!listeners.length) return [];
  if (all) return [...new Set(listeners.map((l) => l.port))].sort((a, b) => a - b);
  const cwds = cwdsFor([...new Set(listeners.map((l) => l.pid))]);
  const inProject = (p) => { const c = cwds[p]; return c && (c === root || c.startsWith(root + path.sep)); };
  return [...new Set(listeners.filter((l) => inProject(l.pid)).map((l) => l.port))].sort((a, b) => a - b);
}

function portsCachePath(root) { return path.join(CACHE_DIR, "ports-" + sha1(path.resolve(root)) + ".json"); }

// TTL-cached so the status-line hot path doesn't shell out to lsof every render.
function getPorts(root, { all = false } = {}) {
  const cp = portsCachePath(root);
  const cached = readJson(cp);
  if (cached && cached.all === all && Date.now() - (cached.at || 0) < PORTS_TTL_MS) return cached.ports || [];
  const ports = computePorts(root, all);
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(cp, JSON.stringify({ ports, all, at: Date.now() })); } catch {}
  return ports;
}

// Render the live ports, clickable. Two styles (RUNCOMMAND_PORT_STYLE overrides):
//   "url"     — full "http://localhost:PORT" visible text; terminals auto-linkify
//               it (⌘-click in Ghostty) even where OSC 8 hyperlinks get stripped
//               (e.g. inside a TUI status bar). Used by the status line.
//   "compact" — short ":PORT" as a real OSC 8 hyperlink; clickable in a shell
//               prompt. Used by `promptline`.
function renderPorts(ports, { style = "compact" } = {}) {
  if (!ports || !ports.length) return "";
  const s = process.env.RUNCOMMAND_PORT_STYLE || style;
  const noColor = !!process.env.NO_COLOR;
  const parts = ports.map((p) => {
    if (s === "url") {
      const t = `http://localhost:${p}`;
      return noColor ? t : cyan(t);
    }
    const t = ":" + p;
    return noColor ? t : `\x1b]8;;http://localhost:${p}\x1b\\${cyan(t)}\x1b]8;;\x1b\\`;
  });
  return dim("◉ ") + parts.join(" ");
}

// ---------- shared command resolution (status line + prompt) ----------

// Non-blocking: returns the known commands (from override or a fresh cache) and
// kicks off background detection on a miss. Never calls the model synchronously.
function currentCommands(root) {
  const override = readOverride(root);
  if (override) return { commands: override.commands, detecting: false };
  const cache = loadCache(root);
  const fresh = cache && cache.signalsHash === signalsHash(root) && (!TTL_MS || Date.now() - (cache.detectedAt || 0) < TTL_MS);
  if (fresh) return { commands: normalizeCommands(cache), detecting: false };
  triggerBackgroundDetect(root);
  const known = normalizeCommands(cache);
  return { commands: known, detecting: known.length === 0 };
}

// ---------- status line ----------

// One compact line: "▶ web: pnpm dev:web · api: pnpm dev:api" (or just the
// command when there's a single unlabeled one). Empty when there's nothing.
function renderRunLine(commands, state) {
  if (state === "detecting") return dim(`${ICON} ${LABEL}finding run command…`);
  const cmds = (commands || []).filter((c) => c && c.command);
  if (cmds.length === 0) return "";
  const parts = cmds.map((c, i) => {
    const prefix = c.label ? dim(c.label + ": ") : (LABEL ? dim(LABEL) : "");
    return prefix + paletteColor(c.command, i);
  });
  return `${dim(ICON)} ` + parts.join(dim(" · "));
}

function statusline(rawStdin) {
  let input = {};
  try { input = JSON.parse(rawStdin || "{}"); } catch {}
  const cwd = input.cwd || (input.workspace && input.workspace.current_dir) || process.cwd();
  const root = findProjectRoot(cwd);

  // Optional: render another status-line tool first, then our line beneath it.
  let base = "";
  const baseCmd = process.env.RUNCOMMAND_BASE;
  if (baseCmd) {
    try {
      const r = spawnSync(baseCmd, { shell: true, input: rawStdin || "", encoding: "utf8", timeout: 3000 });
      if (r.stdout) base = r.stdout.replace(/\n+$/, "");
    } catch {}
  }

  const { commands, detecting } = currentCommands(root);
  const runPart = detecting ? renderRunLine(null, "detecting") : renderRunLine(commands, "ok");
  const portPart = process.env.RUNCOMMAND_NO_PORTS ? "" : renderPorts(getPorts(root), { style: "url" });

  // Run command + live ports share one line: "▶ pnpm dev   ◉ :3000".
  let line = "";
  if (runPart && portPart) line = runPart + "  " + portPart;
  else if (runPart) line = runPart;
  else if (portPart) line = `${dim(ICON)} ` + portPart;

  const out = [base, line].filter((s) => s !== "" && s != null).join("\n");
  if (out) process.stdout.write(out + "\n");
}

// ---------- CLI ----------

const ARGS = { _: [], model: null, project: null, note: null, clearHint: false, quiet: false, locked: false, all: false, json: false, links: false, urls: false };
function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-C" || a === "--project") ARGS.project = argv[++i];
    else if (a === "--model") ARGS.model = argv[++i];
    else if (a === "--hint" || a === "--note") ARGS.note = argv[++i];
    else if (a === "--clear-hint" || a === "--clear-note") ARGS.clearHint = true;
    else if (a === "--quiet" || a === "-q") ARGS.quiet = true;
    else if (a === "--locked") ARGS.locked = true;
    else if (a === "--all") ARGS.all = true;
    else if (a === "--json") ARGS.json = true;
    else if (a === "--links") ARGS.links = true;
    else if (a === "--urls") { ARGS.links = true; ARGS.urls = true; }
    else ARGS._.push(a);
  }
}

function resolveTarget() {
  const dir = ARGS.project || ARGS._[1] || process.cwd();
  return findProjectRoot(dir);
}

const HELP = `runcommand — show each project's run command in the Claude Code status bar

Usage:
  runcommand statusline           render run command + live ports (stdin = Claude Code JSON)
  runcommand prompt [dir]         plain run command for a shell prompt (non-blocking)
  runcommand ports [dir]          project's live localhost ports  (--links --json --all)
  runcommand detect [dir]         detect now (calls claude -p), print + cache
  runcommand get [dir]            print cached command (detect if missing)
  runcommand refresh [dir]        re-detect and overwrite the cache
  runcommand path [dir]           print the cache file path
  runcommand help

Flags: -C/--project <dir>   --model <id>   --quiet
       --hint "<what's wrong>"   steer detection; the note is saved and reused on
                                 later re-detects so the fix doesn't regress
       --clear-hint             forget a previously saved hint
       --links  ":PORT" OSC 8 links   --urls  full "http://localhost:PORT" (auto-linkified)
       --json  ports as JSON   --all  all localhost ports
Env:   RUNCOMMAND_MODEL (default: haiku)   RUNCOMMAND_BASE (chain another status line)
       RUNCOMMAND_ICON   RUNCOMMAND_LABEL   RUNCOMMAND_TTL_MS   NO_COLOR
       RUNCOMMAND_PORT_STYLE (url|compact)   RUNCOMMAND_NO_PORTS   RUNCOMMAND_PORTS_TTL_MS

Per-project override (instant, no model call): a .claude-run file — one command
per line, optional "label: command" — or a "Run: <command>" line in CLAUDE.md.
Several services (web/api/…) render as one line: "web: … · api: …".`;

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const argv = process.argv.slice(2);
  parseArgs(argv);
  QUIET = ARGS.quiet;
  const cmd = ARGS._[0] || "help";

  switch (cmd) {
    case "statusline": {
      const raw = await readStdin();
      try { statusline(raw); } catch (e) { stripAnsiSafeLog("statusline error:", e.message); }
      break;
    }
    case "prompt": {
      // Plain, non-blocking run command for a shell prompt (e.g. starship).
      const root = resolveTarget();
      const { commands } = currentCommands(root);
      const text = commands.map((c) => (c.label ? c.label + ": " : "") + c.command).join(" · ");
      const nl = process.stdout.isTTY ? "\n" : "";
      // Trailing space so a following prompt segment isn't squished. Empty stays empty.
      process.stdout.write((text ? text + " " : "") + nl);
      break;
    }
    case "promptline": {
      // Fully-rendered segment for a shell prompt: run command + clickable ports
      // (OSC 8), styled, or empty. Non-blocking. Meant for a starship custom module.
      const root = resolveTarget();
      const { commands } = currentCommands(root);
      const parts = [renderRunLine(commands, "ok"), renderPorts(getPorts(root), { style: "compact" })].filter(Boolean);
      const line = parts.join("  ");
      // Trailing space so a following prompt segment (e.g. starship's cmd_duration
      // "took 36m") isn't squished against the ports. Empty stays empty.
      process.stdout.write(line ? line + " " : "");
      break;
    }
    case "ports": {
      const root = resolveTarget();
      const ports = getPorts(root, { all: ARGS.all });
      const nl = process.stdout.isTTY ? "\n" : "";
      if (ARGS.json) process.stdout.write(JSON.stringify(ports) + nl);
      else if (ARGS.links) process.stdout.write(renderPorts(ports, { style: ARGS.urls ? "url" : "compact" }) + (ports.length ? nl : ""));
      else process.stdout.write(ports.map((p) => ":" + p).join(" ") + (ports.length ? nl : ""));
      break;
    }
    case "json": {
      // Structured output for other renderers (the OpenCode plugin, etc.).
      const root = resolveTarget();
      const { commands, detecting } = currentCommands(root);
      const ports = getPorts(root, { all: ARGS.all });
      process.stdout.write(JSON.stringify({ root, commands, ports, detecting }) + "\n");
      break;
    }
    case "detect":
    case "refresh": {
      const root = resolveTarget();
      const locked = ARGS.locked || acquireLock(root);
      try {
        const r = detect(root, { quiet: ARGS.quiet, note: ARGS.note, clearNote: ARGS.clearHint });
        if (!ARGS.quiet) process.stdout.write(formatCommandsCLI(r && r.commands) + "\n");
      } finally { if (locked) releaseLock(root); }
      break;
    }
    case "get": {
      const root = resolveTarget();
      const cache = loadCache(root);
      const override = readOverride(root);
      let commands;
      if (override) commands = override.commands;
      else if (cache && cache.signalsHash === signalsHash(root)) commands = normalizeCommands(cache);
      else commands = (detect(root, { quiet: true }) || {}).commands;
      process.stdout.write(formatCommandsCLI(commands) + "\n");
      break;
    }
    case "path": {
      process.stdout.write(cachePathFor(resolveTarget()) + "\n");
      break;
    }
    case "help": case "--help": case "-h": default:
      process.stdout.write(HELP + "\n");
  }
}

main();
