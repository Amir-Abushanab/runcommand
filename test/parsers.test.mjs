// Pure-function tests — no filesystem, no spawning, no model calls.
// The Windows parsers matter most here: they can't be exercised on the machine
// this is developed on, so fixtures are the only coverage they get.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseNetstat,
  cmdlineInProject,
  normalizeCommands,
  formatCommandsCLI,
  keepPort,
  blockVersionIn,
  BLOCK_V,
  CACHE_V,
} from "../bin/runcommand.mjs";

// Real `netstat -ano -p TCP` output shape, with the cases that trip naive parsers.
const NETSTAT = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       968",
  "  TCP    127.0.0.1:4321         0.0.0.0:0              LISTENING       21044",
  "  TCP    [::]:5173              [::]:0                 LISTENING       8123",
  "  TCP    [::1]:9229             [::]:0                 LISTENING       8123",
  "  TCP    192.168.1.7:445        0.0.0.0:0              LISTENING       4",
  "  TCP    127.0.0.1:4321         127.0.0.1:54992        ESTABLISHED     21044",
  "  TCP    127.0.0.1:52001        127.0.0.1:4321         TIME_WAIT       0",
  "  TCP    0.0.0.0:7777           0.0.0.0:0              ABHÖREN         3312",
  "  UDP    0.0.0.0:5353           *:*                                    1720",
].join("\r\n");

test("parseNetstat: keeps localhost and wildcard listeners", () => {
  assert.deepEqual(parseNetstat(NETSTAT), [
    { pid: 968, port: 135 },
    { pid: 21044, port: 4321 },
    { pid: 8123, port: 5173 },
    { pid: 8123, port: 9229 },
    { pid: 3312, port: 7777 },
  ]);
});

test("parseNetstat: the state column is localized, so it is never matched on", () => {
  // German Windows prints ABHÖREN, not LISTENING. Listeners are identified by a
  // foreign address of :0 instead. Regression guard for that choice.
  const rows = parseNetstat(NETSTAT);
  assert.ok(rows.some((r) => r.port === 7777), "localized LISTENING row parsed");
});

test("parseNetstat: excludes non-listeners, UDP and non-local addresses", () => {
  const ports = parseNetstat(NETSTAT).map((r) => r.port);
  assert.ok(!ports.includes(445), "LAN-only 192.168.x listener excluded");
  assert.ok(!ports.includes(54992), "ESTABLISHED excluded");
  assert.ok(!ports.includes(52001), "TIME_WAIT (pid 0) excluded");
  assert.ok(!ports.includes(5353), "UDP excluded");
});

test("parseNetstat: tolerates empty and junk input", () => {
  assert.deepEqual(parseNetstat(""), []);
  assert.deepEqual(parseNetstat("no listeners here\n"), []);
  assert.deepEqual(parseNetstat("  TCP    0.0.0.0:80"), [], "truncated row");
});

const ROOT = "C:\\Users\\amir\\Code\\runcommand";
const inProj = (c) => cmdlineInProject(c, ROOT);

test("cmdlineInProject: matches a project path anywhere in argv", () => {
  assert.ok(inProj('"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\amir\\Code\\runcommand\\site\\node_modules\\astro\\astro.js" dev'));
  assert.ok(inProj("node C:/Users/amir/Code/runcommand/x.js"), "forward slashes");
  assert.ok(inProj('pnpm --dir "c:\\users\\amir\\code\\runcommand\\site" dev'), "case-insensitive, quote boundary");
  assert.ok(inProj("node C:\\Users\\amir\\Code\\runcommand"), "exact root at end of string");
});

test("cmdlineInProject: a sibling directory with the same prefix does not match", () => {
  // The reason the match has to land on a path boundary rather than be a plain
  // substring test: C:\app must not claim a server running from C:\app-legacy.
  assert.ok(!inProj("node C:\\Users\\amir\\Code\\runcommand-legacy\\x.js"));
  assert.ok(!inProj("node C:\\Users\\amir\\Code\\other\\x.js"));
});

test("cmdlineInProject: empty inputs never match", () => {
  assert.ok(!inProj(""));
  assert.ok(!cmdlineInProject("anything", ""));
});

test("normalizeCommands: reads both the current and the legacy cache shape", () => {
  // Backward compat: caches written before multi-command support stored a bare
  // `command` string. Older runcommands also only ever read that field, which is
  // why the current shape keeps `commands` additive rather than renaming it.
  assert.deepEqual(normalizeCommands({ commands: [{ command: "pnpm dev" }] }), [{ command: "pnpm dev" }]);
  assert.deepEqual(normalizeCommands({ command: "pnpm dev" }), [{ command: "pnpm dev" }]);
  assert.deepEqual(normalizeCommands({ commands: [{ label: "web", command: "pnpm dev" }] }), [{ label: "web", command: "pnpm dev" }]);
});

test("normalizeCommands: drops malformed entries instead of throwing", () => {
  assert.deepEqual(normalizeCommands(null), []);
  assert.deepEqual(normalizeCommands({}), []);
  assert.deepEqual(normalizeCommands({ commands: [] }), []);
  assert.deepEqual(normalizeCommands({ commands: [null, { label: "x" }, { command: "" }, { command: "ok" }] }), [{ command: "ok" }]);
  assert.deepEqual(normalizeCommands({ command: "" }), []);
});

test("formatCommandsCLI: labels, multiple commands, and the empty case", () => {
  assert.equal(formatCommandsCLI([{ command: "pnpm dev" }]), "pnpm dev");
  assert.equal(formatCommandsCLI([{ label: "web", command: "a" }, { label: "api", command: "b" }]), "web: a\napi: b");
  assert.equal(formatCommandsCLI([]), "(no run command)");
  assert.equal(formatCommandsCLI(null), "(no run command)");
});

test("keepPort: filters ephemeral and debugger ports", () => {
  assert.ok(keepPort(3000));
  assert.ok(keepPort(49151), "just below the ephemeral floor");
  assert.ok(!keepPort(49152), "ephemeral floor");
  assert.ok(!keepPort(9229), "node debugger");
  assert.ok(!keepPort(9230));
  assert.ok(!keepPort(0));
});

test("blockVersionIn: recognises v1's unversioned marker", () => {
  // The compat guarantee that makes migration possible at all: a block written
  // before markers carried a version must still be found, or `init` would append a
  // second block and `uninstall` would leave the first behind forever.
  assert.equal(blockVersionIn("# >>> runcommand (managed by `runcommand init`)\nx\n# <<< runcommand"), 1);
});

test("blockVersionIn: reads the version out of a stamped marker", () => {
  assert.equal(blockVersionIn("# >>> runcommand v2 (managed by `runcommand init`)\nx\n# <<< runcommand"), 2);
  assert.equal(blockVersionIn("# >>> runcommand v17 (managed by `runcommand init`)"), 17);
});

test("blockVersionIn: null when nothing runcommand-authored is present", () => {
  assert.equal(blockVersionIn(""), null);
  assert.equal(blockVersionIn("[custom.runcommand]\ncommand = 'runcommand promptline'\n"), null,
    "a hand-written module is not a fenced block and must never be rewritten");
});

test("BLOCK_V is ahead of v1, so existing installs are offered a refresh", () => {
  assert.ok(BLOCK_V > 1);
  assert.equal(typeof CACHE_V, "number");
});
