#!/usr/bin/env node
/**
 * runcommand — show each project's run command in the Claude Code status bar.
 *
 * It figures out the single "how do I start this project" command with a quick
 * headless LLM call (Claude Code's `claude -p` by default; any agent via
 * RUNCOMMAND_AGENT / RUNCOMMAND_DETECT_CMD), caches the answer per-project, and
 * only re-asks when the project's manifest actually changes. The status-line path
 * never blocks on the model: on a cache miss it kicks detection off in the
 * background and shows a placeholder until the answer lands.
 *
 * Standalone and dependency-free (Node built-ins only). Coexists with any other
 * status-line tool via RUNCOMMAND_BASE (see `statusline` below) — it never
 * assumes or touches another tool's config.
 *
 * Developed on macOS/Linux. Windows is supported but UNTESTED on real hardware:
 * everything platform-specific is behind IS_WIN (port scan, PATHEXT lookup, init
 * wiring, cache dir) — see the README's Windows section for what differs.
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
 * Env:   RUNCOMMAND_AGENT (detection agent priority list; see `runcommand agents`), RUNCOMMAND_DETECT_CMD,
 *        RUNCOMMAND_AGENT_BIN, RUNCOMMAND_MODEL, RUNCOMMAND_BASE, RUNCOMMAND_ICON,
 *        RUNCOMMAND_LABEL, RUNCOMMAND_TTL_MS, NO_COLOR
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const IS_WIN = process.platform === "win32";
const ICON = process.env.RUNCOMMAND_ICON ?? "▶";
const LABEL = process.env.RUNCOMMAND_LABEL ?? ""; // e.g. "run: "
const DETECT_TIMEOUT_MS = 90_000;
const LOCK_STALE_MS = 3 * 60_000;
// A confirmed answer stays put until the manifest changes. This TTL only
// re-checks projects whose files we couldn't hash (edge cases); default off.
const TTL_MS = Number(process.env.RUNCOMMAND_TTL_MS || 0);

// Cache schema version. Bump when a cached field changes meaning in a way another
// build would misread — a version this code doesn't recognise is simply treated as
// a miss. Cheap insurance: the cache is derived state, so the whole cost of
// throwing one away is a single detection call. (Deliberately NOT applied to the
// ports cache, which self-heals inside its 2.5s TTL.)
const CACHE_V = 1;

const CACHE_DIR = path.join(
  // ~/.cache is a posix convention; Windows keeps throwaway state in LOCALAPPDATA.
  process.env.XDG_CACHE_HOME || (IS_WIN && process.env.LOCALAPPDATA) || path.join(os.homedir(), ".cache"),
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
// Usable = written by a schema we understand AND the project's signals still hash
// the same. Either check failing means re-detect; neither can throw.
const cacheUsable = (cache, root) => !!cache && cache.v === CACHE_V && cache.signalsHash === signalsHash(root);
function saveCache(root, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const p = cachePathFor(root);
    const tmp = p + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ v: CACHE_V, root, ...data }, null, 2));
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

// ---------- detection backend (configurable agent) ----------
//
// Detection only needs a CLI that takes our prompt and prints the model's text
// answer (with <cmd> tags) to stdout. Claude Code (`claude -p`) is the default,
// but any headless agent works: pick one with RUNCOMMAND_AGENT, or supply a full
// command with RUNCOMMAND_DETECT_CMD. The prompt is always handed over as a single
// argv element (never through a shell), so its newlines and quotes can't bite us.
//
// Each built-in agent maps to the flags that put it in one-shot/headless mode.
// `pre(model)` is the args before the prompt; `model` is the default model —
// empty means "let the agent use its own configured default" (only claude, which
// defaults to a big model interactively, needs us to pick the cheap one).
const AGENTS = {
  claude:   { bin: "claude",       pre: (m) => ["-p", ...(m ? ["--model", m] : [])], model: "haiku" },
  opencode: { bin: "opencode",     pre: (m) => ["run", ...(m ? ["--model", m] : [])], model: "" },
  gemini:   { bin: "gemini",       pre: (m) => [...(m ? ["-m", m] : []), "-p"],       model: "" },
  qwen:     { bin: "qwen",         pre: (m) => [...(m ? ["-m", m] : []), "-p"],       model: "" },
  codex:    { bin: "codex",        pre: (m) => ["exec", ...(m ? ["-m", m] : [])],     model: "" },
  cursor:   { bin: "cursor-agent", pre: (m) => ["-p", "--output-format", "text", ...(m ? ["--model", m] : [])], model: "" },
  crush:    { bin: "crush",        pre: (m) => ["run", "-q", ...(m ? ["-m", m] : [])], model: "" },
  amp:      { bin: "amp",          pre: () => ["-x"],                                 model: "" },
  llm:      { bin: "llm",          pre: (m) => (m ? ["-m", m] : []),                  model: "" },
  sgpt:     { bin: "sgpt",         pre: (m) => (m ? ["--model", m] : []),             model: "" },
  // Agentic tools — they edit files / run tools rather than just answer, so they sit
  // LAST in the default chain: reached only when nothing cleaner is installed (i.e. it
  // genuinely IS your agent). Flags minimize side effects; detection only asks a
  // question, so a well-behaved model answers in <cmd> tags without editing anything.
  aider:    { bin: "aider",        pre: (m) => ["--yes", "--no-auto-commits", ...(m ? ["--model", m] : []), "--message"], model: "" },
  goose:    { bin: "goose",        pre: () => ["run", "--no-session", "-t"],          model: "" },
  copilot:  { bin: "copilot",      pre: (m) => ["-p", ...(m ? ["--model", m] : [])],  model: "" },
  // Local models. Kept out of the default chain (below) so it's never auto-run —
  // `ollama run` would pull a multi-GB model on first use. Opt in with
  // RUNCOMMAND_AGENT=ollama (and RUNCOMMAND_MODEL to pick the model).
  ollama:   { bin: "ollama",       pre: (m) => ["run", m || "llama3.2"],             model: "" },
};

// Where agents commonly install, so we don't depend on the status line's PATH
// (which can be minimal). We also scan $PATH as a fallback.
const BIN_DIRS = [
  path.join(os.homedir(), ".local/bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".claude/local"),
  // Windows: npm's global shim dir and the Store alias dir, neither guaranteed on
  // the minimal PATH a status line inherits.
  ...(IS_WIN ? [
    path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm"),
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "WindowsApps"),
  ] : []),
];
// Windows resolves a bare name through PATHEXT (`claude` is really claude.cmd), so
// probing the extensionless path alone finds nothing and every agent looks missing.
const PATHEXTS = IS_WIN
  ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.trim()).filter(Boolean)
  : [];
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
function binAt(dir, name) {
  const base = path.join(dir, name);
  if (isFile(base)) return base;
  for (const ext of PATHEXTS) { const p = base + ext; if (isFile(p)) return p; }
  return null;
}
// Resolve a command to an absolute path, or null if it isn't installed. Checks an
// explicit override, then the well-known dirs, then every entry on $PATH.
function findBin(name, override) {
  if (override && exists(override)) return override;
  for (const dir of BIN_DIRS) { const p = binAt(dir, name); if (p) return p; }
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const p = binAt(dir, name);
    if (p) return p;
  }
  return null;
}

// Detection tries agents in priority order and uses the first that's installed and
// answers — so uninstalling Claude Code silently falls through to whatever else is
// on the machine. Order comes from RUNCOMMAND_AGENT (a comma/space list) or this
// default; unknown names are ignored, uninstalled ones skipped. A full
// RUNCOMMAND_DETECT_CMD is an explicit single backend and bypasses the chain.
const DEFAULT_AGENT_ORDER = ["claude", "opencode", "gemini", "qwen", "codex", "cursor", "crush", "amp", "llm", "sgpt", "aider", "goose", "copilot"];

let AGENT_CHAIN = null;
function agentChain() {
  if (AGENT_CHAIN) return AGENT_CHAIN;
  const custom = (process.env.RUNCOMMAND_DETECT_CMD || "").trim();
  if (custom) {
    const parts = custom.split(/\s+/).filter(Boolean);
    return (AGENT_CHAIN = [{ name: parts[0] || "custom", custom: parts, model: "" }]);
  }
  const raw = (process.env.RUNCOMMAND_AGENT || "").trim();
  const names = (raw ? raw.split(/[,\s]+/) : DEFAULT_AGENT_ORDER).map((n) => n.toLowerCase()).filter(Boolean);
  const model = ARGS.model || process.env.RUNCOMMAND_MODEL || "";
  const chain = [];
  for (const name of names) {
    const spec = AGENTS[name];
    if (!spec) continue; // unknown agent name
    const override = process.env.RUNCOMMAND_AGENT_BIN || (name === "claude" ? process.env.RUNCOMMAND_CLAUDE : "");
    const bin = findBin(spec.bin, override);
    if (!bin) continue; // not installed — try the next one
    const useModel = model || spec.model;
    chain.push({ name, bin, pre: spec.pre(useModel), model: useModel });
  }
  // Nothing named is installed: still attempt the first choice via bare PATH so we
  // fail the same graceful way a single missing agent always has.
  if (chain.length === 0) {
    const first = names.find((n) => AGENTS[n]) || "claude";
    const useModel = model || AGENTS[first].model;
    chain.push({ name: first, bin: AGENTS[first].bin, pre: AGENTS[first].pre(useModel), model: useModel });
  }
  return (AGENT_CHAIN = chain);
}

// [bin, argv] to run one chain entry with our prompt as the final argument.
function invocationFor(entry, prompt) {
  if (entry.custom) {
    const parts = entry.custom.slice();
    const slot = parts.indexOf("{}");
    if (slot !== -1) parts[slot] = prompt; else parts.push(prompt);
    return [parts[0], parts.slice(1)];
  }
  return [entry.bin, [...entry.pre, prompt]];
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
  const chain = agentChain();
  // Try each available agent in priority order. Run in the target root so any
  // ambient project context the agent loads belongs to THIS project — not the dir
  // the status line happened to be invoked from. A process failure (missing/broken
  // agent) falls through to the next; a clean exit is the answer, even when empty
  // (a genuine "no run command"), so we never cascade past a real result.
  for (const entry of chain) {
    const [bin, argv] = invocationFor(entry, prompt);
    const res = spawnSync(bin, argv, {
      cwd: root, encoding: "utf8", timeout: DETECT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024,
      // We always pass the prompt as an argument; detach stdin so an agent can't
      // block waiting on it (or fold an empty piped stdin into its prompt).
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.error || res.status !== 0) {
      const more = chain.length > 1 ? " — trying next agent" : "";
      stripAnsiSafeLog(`detect via ${entry.name} failed${more}:`, res.error ? res.error.message : (res.stderr || "").trim().slice(0, 200));
      continue;
    }
    const commands = parseCommands(res.stdout);
    saveCache(root, { commands, source: "llm", model: entry.model || "", agent: entry.name, note: activeNote, signalsHash: hash, detectedAt: Date.now() });
    return { commands, source: "llm" };
  }
  // Every agent failed — keep any previous answer; don't poison the cache.
  return prev ? { commands: normalizeCommands(prev), source: prev.source } : null;
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

// `netstat -ano -p TCP` rows look like:
//   "  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234"
// The state word is LOCALIZED on non-English Windows, so listeners are identified
// by their foreign address (port 0 for anything not connected) instead of by
// string-matching "LISTENING". Pure function so it can be checked against fixtures.
function parseNetstat(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[0].toUpperCase() !== "TCP") continue;
    const [, local, foreign, , pidStr] = f;
    if (!/:0$/.test(foreign)) continue;
    const m = local.match(LOCAL_ADDR);
    const pid = Number(pidStr);
    if (m && pid > 0) out.push({ pid, port: Number(m[1]) });
  }
  return out;
}

// [{pid, port}] for localhost / wildcard TCP listeners.
function scanListeners() {
  if (IS_WIN) {
    try {
      const res = spawnSync("netstat", ["-ano", "-p", "TCP"],
        { encoding: "utf8", timeout: 4000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      return parseNetstat(res.stdout || "");
    } catch { return []; }
  }
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

// Windows exposes no process working directory to a plain CLI — there is no
// `lsof -d cwd` equivalent, and Win32_Process doesn't carry cwd — so scope by
// COMMAND LINE instead. A dev server started inside a project nearly always has the
// project path in its argv (node running .\node_modules\vite\bin\vite.js, an
// explicit "--dir site", …). It's a proxy for cwd, deliberately biased toward
// showing nothing over showing another project's port.
function cmdlinesFor(pids) {
  const map = {};
  if (!pids.length) return map;
  const filter = pids.map((p) => `ProcessId=${p}`).join(" or ");
  const script = `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }`;
  try {
    const res = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", timeout: 4000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    for (const line of (res.stdout || "").split("\n")) {
      const i = line.indexOf("|");
      if (i < 0) continue;
      const pid = Number(line.slice(0, i));
      if (pid > 0) map[pid] = line.slice(i + 1).trim();
    }
  } catch {}
  return map;
}

// Does a command line point inside this project? Separator- and case-insensitive
// (Windows paths are both), and the hit must land on a path boundary so a project
// at C:\app doesn't claim a server running out of C:\app-legacy.
function cmdlineInProject(cmdline, root) {
  const norm = (s) => s.replace(/\//g, "\\").toLowerCase();
  const hay = norm(cmdline), needle = norm(root);
  if (!needle) return false;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const after = hay[i + needle.length];
    if (after === undefined || after === "\\" || after === '"' || after === "'" || after === " ") return true;
  }
  return false;
}

function computePorts(root, all) {
  const listeners = scanListeners().filter((l) => keepPort(l.port));
  if (!listeners.length) return [];
  const uniq = (ps) => [...new Set(ps)].sort((a, b) => a - b);
  if (all) return uniq(listeners.map((l) => l.port));
  const pids = [...new Set(listeners.map((l) => l.pid))];
  const owner = IS_WIN ? cmdlinesFor(pids) : cwdsFor(pids);
  const inProject = (p) => {
    const c = owner[p];
    if (!c) return false;
    return IS_WIN ? cmdlineInProject(c, root) : (c === root || c.startsWith(root + path.sep));
  };
  return uniq(listeners.filter((l) => inProject(l.pid)).map((l) => l.port));
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
  const fresh = cacheUsable(cache, root) && (!TTL_MS || Date.now() - (cache.detectedAt || 0) < TTL_MS);
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

const ARGS = { _: [], model: null, project: null, note: null, clearHint: false, quiet: false, locked: false, all: false, json: false, links: false, urls: false, yes: false, dryRun: false, probe: false, surfaces: null };
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
    else if (a === "--yes" || a === "-y") ARGS.yes = true;
    else if (a === "--dry-run") ARGS.dryRun = true;
    else if (a === "--probe") ARGS.probe = true;
    else if (a === "--surfaces") ARGS.surfaces = (argv[++i] || "").split(/[,\s]+/).filter(Boolean);
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
  runcommand detect [dir]         detect now (asks the configured agent), print + cache
  runcommand get [dir]            print cached command (detect if missing)
  runcommand refresh [dir]        re-detect and overwrite the cache
  runcommand path [dir]           print the cache file path
  runcommand init                 wire runcommand into your installed tools (--yes --dry-run --surfaces)
  runcommand uninstall            remove runcommand's wiring (--dry-run)
  runcommand agents               show the detection agent chain — which are installed (--probe to test)
  runcommand help

Flags: -C/--project <dir>   --model <id>   --quiet
       --hint "<what's wrong>"   steer detection; the note is saved and reused on
                                 later re-detects so the fix doesn't regress
       --clear-hint             forget a previously saved hint
       --links  ":PORT" OSC 8 links   --urls  full "http://localhost:PORT" (auto-linkified)
       --json  ports as JSON   --all  all localhost ports
Env:   RUNCOMMAND_AGENT   priority list tried in order, first installed wins, e.g.
                          "opencode,claude"; unset = try each installed (see 'runcommand agents')
       RUNCOMMAND_DETECT_CMD ("opencode run", "{}" = prompt slot)   RUNCOMMAND_AGENT_BIN
       RUNCOMMAND_MODEL (default: haiku for claude, else the agent's own default)
       RUNCOMMAND_BASE (chain another status line)   RUNCOMMAND_ICON   RUNCOMMAND_LABEL
       RUNCOMMAND_TTL_MS   NO_COLOR
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

// ---------- init / uninstall (wire runcommand into your tools) ----------

// npx runs us out of a cache directory that sits on PATH for exactly one invocation.
// Both invocation forms we could write from there — a bare `runcommand`, or this
// absolute path — stop resolving the moment npx exits, so `init` would leave behind a
// status line that silently renders nothing. Detect it and ask for a durable install.
function isEphemeralInstall(p = SELF) { return /[\\/]_npx[\\/]/.test(p); }
// How a config file should call runcommand: a bare `runcommand` if it's on PATH,
// else this script through node.
function selfInvocation() {
  return findBin("runcommand") ? "runcommand" : `node ${JSON.stringify(SELF)}`;
}
// Single-quote a string for a POSIX shell — for RUNCOMMAND_BASE='<existing>'.
function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
// Recognize our own wiring in either invocation form (bare or node-script).
function isOurs(cmd) {
  return !!cmd && /statusline/.test(cmd) && (cmd.includes("runcommand statusline") || cmd.includes(path.basename(SELF)));
}
function backupFile(file) {
  if (!exists(file)) return null;
  const bak = `${file}.${Date.now()}.runcommand-bak`;
  fs.copyFileSync(file, bak);
  return bak;
}

// Harnesses whose status line is a JSON "command" field: a surgical merge that
// preserves every other setting. The coexistence wrap keeps any status line you
// already had — runcommand renders it above its own via RUNCOMMAND_BASE.
const JSON_HARNESSES = [
  {
    key: "claude", label: "Claude Code",
    file: path.join(os.homedir(), ".claude", "settings.json"),
    installed: () => exists(path.join(os.homedir(), ".claude")) || !!findBin("claude"),
    envPrefix: "",
    get: (j) => j.statusLine && j.statusLine.command,
    set: (j, cmd) => { j.statusLine = Object.assign({ padding: 0 }, j.statusLine, { type: "command", command: cmd }); },
    del: (j) => { delete j.statusLine; },
  },
  {
    key: "qwen", label: "Qwen Code",
    file: path.join(os.homedir(), ".qwen", "settings.json"),
    installed: () => exists(path.join(os.homedir(), ".qwen")) || !!findBin("qwen"),
    envPrefix: "RUNCOMMAND_PORT_STYLE=url ", // Qwen strips OSC 8; url keeps ports clickable
    get: (j) => j.ui && j.ui.statusLine && j.ui.statusLine.command,
    set: (j, cmd) => { j.ui = j.ui || {}; j.ui.statusLine = Object.assign({}, j.ui.statusLine, { type: "command", command: cmd }); },
    del: (j) => { if (j.ui) delete j.ui.statusLine; },
  },
];
function desiredCommand(h, existing) {
  const ours = h.envPrefix + selfInvocation() + " statusline";
  if (!existing) return ours;             // nothing there: install fresh
  if (isOurs(existing)) return existing;  // already ours (any form): leave it
  return `RUNCOMMAND_BASE=${shq(existing)} ${ours}`; // wrap someone else's line
}
function planJson(h) {
  const existing = h.get(readJson(h.file) || {}) || "";
  const to = desiredCommand(h, existing);
  const action = to === existing ? "none" : existing ? "wrap" : "add";
  return { h, file: h.file, existing, to, action };
}
function applyJson(plan) {
  const j = readJson(plan.h.file) || {};
  plan.h.set(j, plan.to);
  fs.mkdirSync(path.dirname(plan.file), { recursive: true });
  const bak = backupFile(plan.file);
  fs.writeFileSync(plan.file, JSON.stringify(j, null, 2) + "\n");
  return bak;
}
function unwireJson(h) {
  if (!exists(h.file)) return { action: "none" };
  const j = readJson(h.file) || {};
  const existing = h.get(j) || "";
  if (!isOurs(existing)) return { action: "none" };
  const m = existing.match(/RUNCOMMAND_BASE=('([^']*)'|"([^"]*)"|(\S+))\s/);
  const base = m ? (m[2] ?? m[3] ?? m[4]) : null;
  if (base) h.set(j, base); else h.del(j);
  const bak = backupFile(h.file);
  fs.writeFileSync(h.file, JSON.stringify(j, null, 2) + "\n");
  return { action: base ? "unwrapped" : "removed", file: h.file, bak };
}

// Append-block surfaces (starship, tmux): append a marker-fenced block to a config
// file so uninstall removes exactly what init added and never touches a hand-written
// config. Coexistence is native — starship shows custom modules alongside the rest,
// and tmux's `set -ga` APPENDS to your existing status-right rather than clobbering it.
const CONFIG_HOME = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
// Generated blocks carry a schema version in their opening marker, so a later
// release can recognise one it wrote under older rules and offer to refresh it.
// This is the ONLY migration path config has: `npm i -g @amabush/runcommand@latest` updates
// the binary, never the lines already sitting in someone's starship.toml.
//   v1 — original, unversioned marker
//   v2 — starship: format = "($output )", the conditional trailing separator
const BLOCK_V = 3;
const MARK_BEGIN = `# >>> runcommand v${BLOCK_V} (managed by \`runcommand init\`)`;
const MARK_END = "# <<< runcommand";
// Matches every generation of the opening marker, v1's unversioned one included, so
// uninstall and drift detection keep working on blocks older releases wrote.
const MARK_BEGIN_SRC = "# >>> runcommand(?: v(\\d+))? \\(managed by `runcommand init`\\)";
const reEsc = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// keepLead: leave whatever blank space precedes the block alone. Removal wants it
// swallowed (no orphan gap); an in-place refresh wants the user's spacing intact.
const blockRegionRe = ({ keepLead = false } = {}) =>
  new RegExp((keepLead ? "" : "\\n*") + MARK_BEGIN_SRC + "[\\s\\S]*?" + reEsc(MARK_END) + "\\n?", "g");
// null when the file holds no runcommand block; otherwise the version that wrote it.
function blockVersionIn(text) {
  const m = text.match(new RegExp(MARK_BEGIN_SRC));
  return m ? Number(m[1] || 1) : null;
}
const STARSHIP_FILE = path.join(CONFIG_HOME, "starship.toml");
const TMUX_FILE = exists(path.join(CONFIG_HOME, "tmux", "tmux.conf"))
  ? path.join(CONFIG_HOME, "tmux", "tmux.conf")
  : path.join(os.homedir(), ".tmux.conf");

const BLOCK_HARNESSES = [
  {
    key: "starship", label: "starship", file: STARSHIP_FILE,
    installed: () => !!findBin("starship") || exists(STARSHIP_FILE),
    already: (cur) => cur.includes("[custom.runcommand]"),
    block: (self, win) => [
      "[custom.runcommand]",
      `command = ${JSON.stringify(self + " promptline")}`,
      // REQUIRED. A custom module with no `when`/`detect_*` condition never runs, so
      // the segment renders as nothing at all — silently, with the command never
      // spawned. `promptline` decides for itself whether there's anything to show
      // (it prints an empty string outside a project), so the condition is just true.
      "when = true",
      // starship TRIMS a custom module's output, so promptline's own trailing space
      // never survives — the separator has to live in the format. The (…) group keeps
      // it conditional, so an empty segment doesn't leave a stray space behind.
      'format = "($output )"',
      // Pin the shell so a heavy interactive profile never runs once per prompt.
      // Windows has no bash to pin — omitting it lets starship use its cmd /C default.
      ...(win ? [] : ['shell = ["bash", "--noprofile", "--norc"]']),
      "ignore_timeout = true", // promptline can outlast starship's 500ms global cap
    ],
    // Configs wired before the format fix squish the next segment (":4321took 10s").
    // Never rewritten for you — a starship.toml is hand-owned — just pointed at.
    stale: (cur) => (/format\s*=\s*['"]\$output['"]/.test(cur)
      ? 'format = "$output"  →  format = "($output )"   (starship trims the command output, so the space that separates the next segment has to live in the format)'
      : null),
  },
  {
    key: "tmux", label: "tmux", file: TMUX_FILE,
    installed: () => !!findBin("tmux") || exists(TMUX_FILE),
    already: (cur) => /status-right.*runcommand/.test(cur),
    block: (self, _win) => [`set -ga status-right " #(${self} prompt -C '#{pane_current_path}')"`],
  },
];
function blockText(h) { return [MARK_BEGIN, ...h.block(selfInvocation(), IS_WIN), MARK_END, ""].join("\n"); }
// Content hash of each generated block, invocation stubbed and platform passed in
// rather than read from IS_WIN, so every runner produces the same numbers AND the
// Windows variant gets checked on machines that can't run Windows. Tests pin these
// against BLOCK_V: editing a block without bumping the version is the one mistake
// that silently leaves every existing install on stale config, and a package
// release can't undo it.
function blockFingerprints() {
  const out = {};
  for (const h of BLOCK_HARNESSES) {
    out[h.key] = {
      posix: sha1(h.block("<self>", false).join("\n")),
      win32: sha1(h.block("<self>", true).join("\n")),
    };
  }
  return out;
}
function planBlock(h) {
  const cur = exists(h.file) ? fs.readFileSync(h.file, "utf8") : "";
  const v = blockVersionIn(cur);
  // Fenced by us: safe to rewrite, since we wrote every line between the markers.
  if (v !== null) return { file: h.file, action: v < BLOCK_V ? "refresh" : "none", from: v };
  // Wired by hand (no markers): never rewrite it — only name what's out of date.
  if (h.already && h.already(cur)) return { file: h.file, action: "none", stale: h.stale ? h.stale(cur) : null };
  return { file: h.file, action: "add" };
}
// Swap a fenced block for the current one, leaving everything outside the markers
// untouched. Backed up first, like every other write init makes.
function replaceBlock(h) {
  const bak = backupFile(h.file);
  const cur = fs.readFileSync(h.file, "utf8");
  fs.writeFileSync(h.file, cur.replace(blockRegionRe({ keepLead: true }), blockText(h)));
  return bak;
}
function applyBlock(h) {
  fs.mkdirSync(path.dirname(h.file), { recursive: true });
  const bak = backupFile(h.file);
  const cur = exists(h.file) ? fs.readFileSync(h.file, "utf8") : "";
  const sep = cur ? (cur.endsWith("\n") ? "\n" : "\n\n") : "";
  fs.writeFileSync(h.file, cur + sep + blockText(h));
  return bak;
}
function unwireBlock(h) {
  if (!exists(h.file)) return { action: "none" };
  const cur = fs.readFileSync(h.file, "utf8");
  const re = blockRegionRe();
  if (!re.test(cur)) return { action: "none" };
  const bak = backupFile(h.file);
  fs.writeFileSync(h.file, cur.replace(re, "\n"));
  return { action: "removed", file: h.file, bak };
}
function manualNotes(say) {
  if (!!findBin("opencode") || exists(path.join(CONFIG_HOME, "opencode"))) {
    say(`\n• OpenCode detected — it renders via a plugin, not a status-line command.`);
    say(`  See the README "Other surfaces" for the drop-in plugin;`);
    say(`  this installer doesn't manage plugins.`);
  }
  if (!!findBin("codex") || exists(path.join(os.homedir(), ".codex"))) {
    say(`\n• Codex detected — a native status line is pending (openai/codex#17827).`);
    say(`  Until then use the /runcommand prompt; see the README.`);
  }
  if (!!findBin("zellij") || exists(path.join(CONFIG_HOME, "zellij"))) {
    say(`\n• Zellij detected — its native status bar can't run commands, so wiring needs the`);
    say(`  zjstatus plugin (a .wasm download + a layout change). This installer won't`);
    say(`  download plugins; add to your layout:`);
    say(`    plugin location="file:~/.config/zellij/plugins/zjstatus.wasm" {`);
    say(`      format_left "{command_runcommand}"`);
    say(`      command_runcommand_command "bash -lc '${selfInvocation()} prompt'"`);
    say(`      command_runcommand_format "{stdout}"  command_runcommand_interval "5"`);
    say(`    }`);
    say(`  Full steps: README "Ambient surfaces".`);
  }
}
async function confirm(rl, q) {
  if (!rl) return true; // non-interactive (--yes): assume yes
  const a = (await new Promise((r) => rl.question(q, r))).trim().toLowerCase();
  return a === "" || a === "y" || a === "yes";
}

async function runInit() {
  const dry = ARGS.dryRun;
  const say = (s = "") => process.stdout.write(s + "\n");
  if (isEphemeralInstall()) {
    say(`runcommand init: this is running through npx, out of a cache directory that`);
    say(`goes away when the command exits — so every line init wrote would point at a`);
    say(`runcommand that no longer exists, and your status line would just go blank.`);
    say(``);
    say(`Install it for real first, then wire it up:`);
    say(``);
    say(`  npm i -g @amabush/runcommand && runcommand init`);
    return;
  }
  const auto = [...JSON_HARNESSES, ...BLOCK_HARNESSES];
  const interactive = !!process.stdin.isTTY && !ARGS.yes;
  if (!interactive && !ARGS.yes && !dry) {
    say("runcommand init: run in a terminal, or pass --yes to apply (or --dry-run to preview).");
    return;
  }
  const rl = interactive ? (await import("node:readline")).createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    say(`\nruncommand init — wire the run-command line into your tools\n`);
    // 1. PATH
    const onPath = findBin("runcommand");
    if (onPath) say(`✓ runcommand on PATH: ${onPath}`);
    else if (IS_WIN) {
      // No ~/.local/bin convention, and fs.symlink needs Developer Mode or admin.
      // npm's generated shim is the supported way to put a name on PATH here.
      say(`• runcommand isn't on your PATH; configs will call it via: ${selfInvocation()}`);
      say(`  To shorten that: npm i -g ${JSON.stringify(path.dirname(path.dirname(SELF)))}`);
    } else {
      const target = path.join(os.homedir(), ".local", "bin", "runcommand");
      say(`• runcommand isn't on your PATH; configs will call it via: ${selfInvocation()}`);
      if (dry) say(`  [dry-run] could symlink ${target} → this script`);
      else if (await confirm(rl, `  Symlink ${target} → this script? [Y/n] `)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        try { fs.unlinkSync(target); } catch {}
        fs.symlinkSync(SELF, target);
        say(`  ✓ linked ${target} (ensure ~/.local/bin is on your PATH)`);
      } else say(`  (skipped PATH symlink)`);
    }
    // 2. pick surfaces
    let picks;
    if (ARGS.surfaces) picks = auto.filter((h) => ARGS.surfaces.includes(h.key));
    else if (!interactive) picks = auto.filter((h) => h.installed());
    else {
      say(`\nHarnesses:`);
      auto.forEach((h, i) => say(`  ${i + 1}. ${h.label}${h.installed() ? "  (installed)" : ""}`));
      const a = (await new Promise((r) => rl.question(`\nWire which? numbers, or Enter for all installed: `, r))).trim();
      picks = a ? a.split(/[,\s]+/).map((n) => auto[parseInt(n, 10) - 1]).filter(Boolean) : auto.filter((h) => h.installed());
    }
    if (!picks.length) { say(`\nNothing to wire.`); manualNotes(say); return; }
    say(`\nWiring: ${picks.map((h) => h.label).join(", ")}`);
    // 3. apply
    for (const h of picks) {
      if (h.block) {
        const p = planBlock(h);
        if (p.action === "none") {
          say(`\n  ${h.label}: already wired — ${p.file}`);
          if (p.stale) say(`    ↻ worth updating by hand:  ${p.stale}`);
          continue;
        }
        if (p.action === "refresh") {
          say(`\n  ${h.label}: block was written by v${p.from}, current is v${BLOCK_V} — ${p.file}`);
          if (dry) { say(`    [dry-run] would refresh the block in place`); continue; }
          if (!(await confirm(rl, `    refresh it in place? [Y/n] `))) { say(`    skipped`); continue; }
          const bak = replaceBlock(h);
          say(`    ✓ refreshed${bak ? `  (backup: ${path.basename(bak)})` : ""}`);
          if (h.key === "tmux") say(`    reload with: tmux source-file ${p.file}  (or restart tmux)`);
          continue;
        }
        say(`\n  ${h.label}: append runcommand block → ${p.file}`);
        if (dry) { say(`    [dry-run] not written`); continue; }
        if (!(await confirm(rl, `    apply? [Y/n] `))) { say(`    skipped`); continue; }
        const bak = applyBlock(h);
        say(`    ✓ appended${bak ? `  (backup: ${path.basename(bak)})` : ""}`);
        if (h.key === "tmux") say(`    reload with: tmux source-file ${p.file}  (or restart tmux)`);
        continue;
      }
      const p = planJson(h);
      if (p.action === "none") { say(`\n  ${h.label}: already wired — ${p.file}`); continue; }
      say(`\n  ${h.label}: ${p.file}`);
      if (p.action === "wrap") say(`    (keeps your current status line; runcommand renders beneath it)`);
      say(`    statusLine.command = ${p.to}`);
      if (dry) { say(`    [dry-run] not written`); continue; }
      if (!(await confirm(rl, `    apply? [Y/n] `))) { say(`    skipped`); continue; }
      const bak = applyJson(p);
      say(`    ✓ wired${bak ? `  (backup: ${path.basename(bak)})` : ""}`);
    }
    manualNotes(say);
    // 4. agent chain summary
    const chain = DEFAULT_AGENT_ORDER.filter((n) => findBin(AGENTS[n].bin));
    say(`\nDetection tries (first available wins): ${chain.join(" → ") || "no agents found"}`);
    say(`  Reorder/pin with RUNCOMMAND_AGENT (e.g. RUNCOMMAND_AGENT=opencode,claude).`);
    say(`  Re-check installed agents anytime: runcommand agents`);
    say(`\nDone${dry ? " (dry-run — nothing written)" : ""}. Restart your terminal / harness.`);
  } finally { if (rl) rl.close(); }
}

async function runUninstall() {
  const dry = ARGS.dryRun;
  const say = (s = "") => process.stdout.write(s + "\n");
  say(`\nruncommand uninstall — remove wiring\n`);
  for (const h of JSON_HARNESSES) {
    const existing = exists(h.file) ? (h.get(readJson(h.file) || {}) || "") : "";
    if (!isOurs(existing)) { say(`  ${h.label}: not wired by runcommand — left alone`); continue; }
    const wrapped = /RUNCOMMAND_BASE=/.test(existing);
    if (dry) { say(`  ${h.label}: [dry-run] would ${wrapped ? "restore your previous status line" : "remove statusLine"} — ${h.file}`); continue; }
    const r = unwireJson(h);
    say(`  ${h.label}: ${r.action === "unwrapped" ? "restored your previous status line" : "removed statusLine"} — ${h.file}${r.bak ? `  (backup: ${path.basename(r.bak)})` : ""}`);
  }
  for (const h of BLOCK_HARNESSES) {
    const cur = exists(h.file) ? fs.readFileSync(h.file, "utf8") : "";
    if (blockVersionIn(cur) !== null) {
      if (dry) say(`  ${h.label}: [dry-run] would remove the runcommand block — ${h.file}`);
      else { const r = unwireBlock(h); say(`  ${h.label}: removed runcommand block — ${h.file}${r.bak ? `  (backup: ${path.basename(r.bak)})` : ""}`); }
    } else if (h.already && h.already(cur)) {
      say(`  ${h.label}: a runcommand config exists but wasn't added by init (no marker) — left alone`);
    } else say(`  ${h.label}: not wired by runcommand — left alone`);
  }
  say(`\nDone${dry ? " (dry-run)" : ""}. Backups (*.runcommand-bak) are kept next to each file.`);
}

// Inspect the detection chain: which agents are installed, in what order, which
// one wins. --probe additionally calls each installed agent to confirm it responds
// (installed ≠ authenticated/working).
function runAgents() {
  const say = (s = "") => process.stdout.write(s + "\n");
  const binOf = (n) => findBin(AGENTS[n].bin, n === "claude" ? process.env.RUNCOMMAND_CLAUDE : process.env.RUNCOMMAND_AGENT_BIN);
  say("\nDetection agents\n");
  const custom = (process.env.RUNCOMMAND_DETECT_CMD || "").trim();
  if (custom) {
    say("  A custom command is set (RUNCOMMAND_DETECT_CMD) — it bypasses the chain:");
    say(`    ${custom}\n`);
    return;
  }
  const chain = agentChain();
  const inChain = new Set(chain.map((e) => e.name));
  say("  Will try, in order:");
  if (!chain.length) say("    (none found)");
  chain.forEach((e, i) => say(`    ${i + 1}. ${e.name.padEnd(9)} ${e.bin}   (model: ${e.model || "agent default"})`));
  const known = Object.keys(AGENTS);
  const idle = known.filter((n) => !inChain.has(n) && binOf(n));
  const missing = known.filter((n) => !inChain.has(n) && !binOf(n));
  if (idle.length) say(`\n  Installed but not in the active chain (opt in via RUNCOMMAND_AGENT): ${idle.join(", ")}`);
  if (missing.length) say(`\n  Not installed: ${missing.join(", ")}`);
  const raw = (process.env.RUNCOMMAND_AGENT || "").trim();
  say(`\n  Order source: ${raw ? `RUNCOMMAND_AGENT=${raw}` : `default (${DEFAULT_AGENT_ORDER.join("→")})`}`);
  if (process.env.RUNCOMMAND_MODEL) say(`  RUNCOMMAND_MODEL=${process.env.RUNCOMMAND_MODEL} (applied to whichever agent runs)`);
  if (ARGS.probe) {
    say("\n  Probing (one tiny call per installed agent)…");
    for (const e of chain) {
      const [bin, argv] = invocationFor(e, "Reply with exactly this and nothing else: <cmd>pong</cmd>");
      const t0 = Date.now();
      const res = spawnSync(bin, argv, { cwd: process.cwd(), encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      const ran = !res.error && res.status === 0;
      const ok = ran && /<cmd>\s*pong\s*<\/cmd>/i.test(res.stdout || "");
      say(`    ${ok ? "✓" : ran ? "~" : "✗"} ${e.name.padEnd(9)} ${ok ? "responds" : ran ? "ran, unexpected output" : "failed"}  (${Date.now() - t0}ms)`);
    }
  } else {
    say(`\n  Add --probe to call each installed agent and confirm it actually responds.`);
  }
  say("");
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
      // Trailing space so a bare consumer (a hand-rolled PS1) doesn't squish the next
      // segment against the ports. starship trims this away — its module carries the
      // separator in `format` instead (see BLOCK_HARNESSES). Empty stays empty.
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
      else if (cacheUsable(cache, root)) commands = normalizeCommands(cache);
      else commands = (detect(root, { quiet: true }) || {}).commands;
      process.stdout.write(formatCommandsCLI(commands) + "\n");
      break;
    }
    case "path": {
      process.stdout.write(cachePathFor(resolveTarget()) + "\n");
      break;
    }
    case "init": await runInit(); break;
    case "uninstall": await runUninstall(); break;
    case "agents": case "agent": runAgents(); break;
    case "help": case "--help": case "-h": default:
      process.stdout.write(HELP + "\n");
  }
}

// Run only when invoked as the CLI — importing this file (from tests) must not
// execute anything. argv[1] is the symlink when installed via ~/.local/bin, while
// import.meta.url is already symlink-resolved, so compare real paths.
const invokedAsCli = (() => {
  const a = process.argv[1];
  if (!a) return false;
  const eq = (x, y) => (IS_WIN ? x.toLowerCase() === y.toLowerCase() : x === y);
  try { return eq(fs.realpathSync(a), SELF); } catch { return eq(path.resolve(a), SELF); }
})();
if (invokedAsCli) main();

// Pure helpers, exported for tests. Nothing here touches the filesystem or spawns.
export { parseNetstat, cmdlineInProject, normalizeCommands, formatCommandsCLI, keepPort, blockVersionIn, blockFingerprints, isEphemeralInstall, BLOCK_V, CACHE_V };
