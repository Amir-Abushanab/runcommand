/**
 * runcommand — OpenCode TUI plugin.
 *
 * OpenCode has no `statusLine` command setting; instead it lets a plugin render
 * Solid components into a named slot of the host layout. This registers a line in
 * `app_bottom` (persistent, host-owned) showing the project's run command and its
 * live localhost ports — the ports as REAL clickable links via OpenTUI's `<a href>`
 * (⌘-click / ctrl-click, the terminal's own modifier).
 *
 * No detection logic lives here. It shells out to `runcommand json` for the parts,
 * so caching, scoping, filtering and LLM detection all stay in the one CLI. The
 * CLI is resolved relative to this file, so the plugin is self-contained.
 *
 * Register it by adding this directory to `~/.config/opencode/tui.json`:
 *   { "plugin": ["/absolute/path/to/runcommand/integrations/opencode"] }
 */
import type { TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createRoot, createSignal, onCleanup } from "solid-js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/** The runcommand CLI, resolved relative to this file (…/bin/runcommand.mjs). */
function runcommandCmd(): readonly string[] {
  const override = process.env["RUNCOMMAND_CMD"];
  if (override !== undefined && override.length > 0) return override.split(" ");
  const mjs = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "runcommand.mjs");
  return [process.execPath, mjs];
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

  api.slots.register({
    // Late order: the host's own model/dir readout keeps its place; we sit after it.
    order: 90,
    slots: {
      app_bottom() {
        const d = data();
        if (d === null) return null;
        if (d.commands.length === 0 && d.ports.length === 0 && !d.detecting) return null;
        return runRow(d);
      },
    },
  });
}

const plugin: TuiPluginModule = {
  id: "runcommand",
  tui: (api) => {
    createRoot((disposeRoot) => {
      initialize(api, disposeRoot);
    });
    return Promise.resolve();
  },
};

export default plugin;
