/** @jsxImportSource @opentui/solid */
/**
 * runcommand — OpenCode TUI plugin.
 *
 * The pragma above is load-bearing and must stay at the top of this file. The
 * loader resolves `jsxImportSource` from the tsconfig it finds relative to its
 * WORKING DIRECTORY, and OpenCode runs in the user's project — so tsconfig.json
 * next to this file is never found, JSX compiles against React, and the import
 * dies on `react/jsx-dev-runtime`. The slot then never registers and the footer
 * renders nothing, with no error on screen. A per-file pragma is cwd-independent.
 *
 * OpenCode has no `statusLine` command setting; instead it lets a plugin render
 * Solid components into a named slot of the host layout. This registers a line in
 * `app_bottom` (persistent, host-owned) showing the project's run command and its
 * live localhost ports — the ports as REAL clickable links via OpenTUI's `<a href>`
 * (⌘-click / ctrl-click, the terminal's own modifier).
 *
 * No detection logic lives here. It shells out to `runcommand json` for the parts,
 * so caching, scoping, filtering and LLM detection all stay in the one CLI.
 *
 * Register it in `~/.config/opencode/tui.json` — either the package, if installed
 * from npm, or this directory from a checkout:
 *   { "plugin": ["~/.config/opencode/node_modules/@amabush/runcommand-opencode/dist/tui.js"] }
 *   { "plugin": ["/absolute/path/to/runcommand/integrations/opencode/dist/tui.js"] }
 * Register a FILE PATH, not a package name. OpenCode resolves plugin specifiers from
 * the project it is running in, not from ~/.config/opencode, so an installed package
 * is not on the resolution path and simply isn't found — with no error, just no
 * plugin. The path must end at dist/tui.js: `exports` maps "./tui" to it, but exports
 * only apply to package specifiers, never to paths.
 */
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createRoot, createSignal, onCleanup, Show } from "solid-js";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Opt-in tracing: RUNCOMMAND_OPENCODE_DEBUG=/tmp/rc.log opencode
 *
 * This plugin fails silently by design — a bad load, a dead Solid build or an
 * untracked read all render as "no footer, no error". Every one of those cost real
 * hours to tell apart, so the probes stay, switched off by default.
 */
const DBG = process.env["RUNCOMMAND_OPENCODE_DEBUG"] ?? "";
function dbg(msg: string): void {
  if (DBG === "") return;
  try { require("node:fs").appendFileSync(DBG, `${new Date().toISOString()} ${msg}\n`); } catch {}
}
dbg("module evaluated");

/** How often the line re-reads state. A spawn behind a disk cache — cheap. */
const REFRESH_MS = Number(process.env["RUNCOMMAND_OPENCODE_REFRESH_MS"] ?? "5000");
/** A spawn that outlives its usefulness holds up nothing here, but cap it anyway. */
const TIMEOUT_MS = 4000;
/** Per-service colours, cycled. A single command stays the first (cyan). */
const PALETTE = ["cyan", "magenta", "green", "blue"] as const;

interface RunData {
  readonly commands: ReadonlyArray<{ label?: string; command: string }>;
  readonly ports: ReadonlyArray<number>;
  readonly detecting: boolean;
}

/** The runcommand CLI: the sibling checkout if there is one, else whatever is on PATH. */
function runcommandCmd(): readonly string[] {
  const override = process.env["RUNCOMMAND_CMD"];
  if (override !== undefined && override.length > 0) return override.split(" ");
  // In a checkout the CLI sits two levels up. Installed from npm it does not —
  // there is no sibling bin/ — and without this check the spawn simply fails and
  // the slot renders empty, with nothing on screen to explain why.
  const mjs = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "runcommand.mjs");
  if (existsSync(mjs)) return [process.execPath, mjs];
  return ["runcommand"];
}

/** Ask the CLI for the parts. Any failure returns null → the slot renders nothing. */
async function fetchRun(dir: string): Promise<RunData | null> {
  const [cmd, ...args] = runcommandCmd();
  if (cmd === undefined) return null;
  let proc: Bun.Subprocess<"ignore", "pipe", "ignore"> | undefined;
  try {
    proc = Bun.spawn({ cmd: [cmd, ...args, "json", "--project", dir], stdout: "pipe", stderr: "ignore" });
    const out = await Promise.race([
      new Response(proc.stdout).text(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ]);
    if (out === null) return null;
    const line = out.split("\n").find((value) => value.trim().length > 0);
    if (line === undefined) return null;
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Partial<RunData>;
    return {
      commands: Array.isArray(p.commands) ? p.commands.filter((c) => c && typeof c.command === "string") : [],
      ports: Array.isArray(p.ports) ? p.ports.filter((n) => typeof n === "number") : [],
      detecting: p.detecting === true,
    };
  } catch {
    return null;
  } finally {
    proc?.kill();
  }
}

function runRow(data: RunData): JSX.Element {
  const cmds = data.commands;
  return (
    <box paddingLeft={2} paddingRight={2}>
      <text>
        <span style={{ dim: true }}>▶ </span>
        {data.detecting && cmds.length === 0 ? (
          <span style={{ dim: true }}>finding run command…</span>
        ) : (
          cmds.map((c, i) => (
            <span>
              {i > 0 ? <span style={{ dim: true }}> · </span> : null}
              {c.label !== undefined && c.label.length > 0 ? (
                <span style={{ dim: true }}>{c.label}: </span>
              ) : null}
              <span style={{ fg: PALETTE[i % PALETTE.length] }}>{c.command}</span>
            </span>
          ))
        )}
        {data.ports.length > 0 ? (
          <span style={{ dim: true }}>{cmds.length > 0 ? "  ◉ " : "◉ "}</span>
        ) : null}
        {data.ports.map((port, i) => (
          <span>
            {i > 0 ? " " : null}
            <a href={`http://localhost:${port}`} style={{ fg: "cyan", underline: true }}>
              {`:${port}`}
            </a>
          </span>
        ))}
      </text>
    </box>
  );
}

function initialize(api: TuiPluginApi, disposeRoot: () => void): void {
  const [data, setData] = createSignal<RunData | null>(null);
  let disposed = false;

  const directory = (): string => {
    const dir = api.state?.path?.directory;
    return typeof dir === "string" && dir.length > 0 ? dir : process.cwd();
  };

  const refresh = (): void => {
    void (async () => {
      const next = await fetchRun(directory());
      dbg(`fetchRun(${directory()}) -> ${next === null ? "null" : JSON.stringify(next).slice(0, 90)}`);
      if (!disposed) setData(next);
    })();
  };

  refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  onCleanup(() => {
    disposed = true;
    clearInterval(timer);
    disposeRoot();
  });

  // Derived: the data worth showing, or false. Read inside <Show> so it stays tracked.
  const shown = (): RunData | false => {
    const d = data();
    if (d === null) return false;
    if (d.commands.length === 0 && d.ports.length === 0 && !d.detecting) return false;
    return d;
  };

  dbg("registering slot");
  api.slots.register({
    // Late order: the host's own model/dir readout keeps its place; we sit after it.
    order: 90,
    slots: {
      // The host calls this ONCE, to build the view. Reading data() in the function
      // body would therefore capture a single value — null, at startup — and nothing
      // would ever re-read it, however reactive the signal is. The read has to happen
      // inside the returned JSX, where Solid tracks it as a computation and swaps the
      // content in place. <Show> renders nothing while there is nothing to show.
      app_bottom() {
        dbg("app_bottom() called (building reactive view)");
        return (
          <Show when={shown()} keyed>
            {(d: RunData) => {
              dbg(`rendering row: ${JSON.stringify(d).slice(0, 80)}`);
              return runRow(d);
            }}
          </Show>
        );
      },
    },
  });
}

const plugin: TuiPluginModule = {
  id: "runcommand",
  tui: (api) => {
    dbg("tui() called");
    createRoot((disposeRoot) => {
      initialize(api, disposeRoot);
    });
    return Promise.resolve();
  },
};

export default plugin;
