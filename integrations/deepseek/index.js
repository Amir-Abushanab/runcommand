/**
 * runcommand — DeepSeek Harness plugin, HOST plane.
 *
 * dsh has no status-line setting; it composes Cordis plugins, and a plugin seats
 * UI in a named Slot. The browser half can't spawn a process, so this row does
 * it: one HTTP route on dsh's own web server that shells out to `runcommand json`.
 * Detection, caching, project scoping and port filtering all stay in the CLI —
 * the same division of labour as the OpenCode plugin.
 *
 * Deliberately NOT an api-gateway Remote: those are a generated, typed BFF, and a
 * third-party row shouldn't need their codegen to publish one read-only value.
 *
 * The browser half ships through `exports["./client"]` — see ./client.js.
 *
 * @module runcommand-dsh
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Cordis plugin name. */
export const name = "runcommand";
/** The HTTP carrier this row hangs its route on. */
export const inject = ["webServer"];

/** Where the client polls. */
const ROUTE = "/runcommand";
/** A spawn that outlives its usefulness helps nobody; cap it. */
const TIMEOUT_MS = 4000;
/** Nothing to show, in the shape the client expects. */
const EMPTY = { commands: [], ports: [], detecting: false };

/**
 * The runcommand CLI: the sibling checkout when this lives inside the repo, else
 * whatever `runcommand` is on PATH — installed from npm there is no sibling bin/.
 */
function runcommandCmd() {
  const override = process.env["RUNCOMMAND_CMD"];
  if (override !== undefined && override.length > 0) return override.split(" ");
  const mjs = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "runcommand.mjs");
  if (existsSync(mjs)) return [process.execPath, mjs];
  return ["runcommand"];
}

/** Ask the CLI for a project's parts. Any failure reads as "nothing to show". */
function read(dir) {
  const [cmd, ...pre] = runcommandCmd();
  if (cmd === undefined) return EMPTY;
  const args = [...pre, "json", ...(typeof dir === "string" && dir.length > 0 ? ["--project", dir] : [])];
  try {
    const res = spawnSync(cmd, args, { encoding: "utf8", timeout: TIMEOUT_MS, windowsHide: true });
    const line = (res.stdout || "").split("\n").find((value) => value.trim().length > 0);
    if (line === undefined) return EMPTY;
    const parsed = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    return {
      commands: Array.isArray(parsed.commands) ? parsed.commands.filter((c) => c && c.command) : [],
      ports: Array.isArray(parsed.ports) ? parsed.ports : [],
      detecting: parsed.detecting === true,
    };
  } catch {
    return EMPTY;
  }
}

/** Publish the route the browser half polls. */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: ROUTE,
      handler: (req, res) => {
        let dir = null;
        try { dir = new URL(req.url, "http://localhost").searchParams.get("dir"); } catch {}
        const body = JSON.stringify(read(dir));
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(body);
      },
    }),
    "runcommand.route()",
  );
}
