# runcommand — OpenCode plugin

Shows the project's run command + **clickable** live localhost ports in the
OpenCode TUI, in the persistent `app_bottom` slot:

```
▶ pnpm dev   ◉ :3000 :5173
```

Unlike Claude Code / Codex, OpenCode has no "status-line command" setting — it
loads **TUI plugins** (Solid components rendered into host slots). This plugin is
that thin adapter: it shells out to `runcommand json` for the parts, so all
detection, caching, scoping and port filtering stay in the one CLI. Ports are real
OpenTUI `<a href>` links, so they're clickable with your terminal's modifier
(**⌘-click** on macOS, **ctrl-click** elsewhere).

## Install

The plugin needs `solid-js` and `@opentui/solid` resolvable from here. They're
declared as **peer** dependencies on purpose: a second copy of `solid-js` is a
second reactive graph, and a second `@opentui/solid` is a second renderer, so a
shared copy is the one that works.

**From this checkout**, `pnpm install` at the repo root is enough — this directory
is a workspace package, so pnpm provides both peers and resolves `@opentui/core`
inside `@opentui/solid`'s own store directory.

```sh
pnpm install           # from the repo root
```

Do **not** hand-symlink the peers into `node_modules/` here. That used to be the
advice for sharing one copy with another plugin, but pnpm now owns this directory
and will replace some links and not others — a stale symlink pointing at a since
emptied directory silently breaks plugin load, with nothing in the TUI to say why.

**Standalone** (not from a checkout), install the peers however your OpenCode
install resolves them:

```sh
bun install            # in the plugin directory
bun run build          # bundles tui.tsx -> dist/tui.js
```

**A filesystem path must point at `dist/tui.js`, not the directory.** `exports` only
applies to package specifiers — a path gets plain file resolution, so
`.../integrations/opencode/tui` would load `tui.tsx` **source**, unbundled, with the dead
server build of Solid. That's why the source now lives in `src/`: the shorter path fails
loudly instead of silently loading the wrong file. Installed from npm, the package form
`@amabush/runcommand-opencode/tui` goes through `exports` and lands on the bundle.

**The build is required, not optional.** `dist/` is what `exports` points at, and it
isn't committed. It also isn't just a compile step: the bundle is produced with
`--conditions=browser`, which pins the build to the **client** flavor of the bits it
bundles. Loaded from source, `solid-js` resolves through the `node` condition to
`dist/server.js` — Solid's server-rendering build, whose effects never run. The plugin
then loads, registers its slot, renders once with no data, and never updates again: an
empty footer with no error anywhere.

`solid-js`, `@opentui/solid`, `@opentui/core` and `@opencode-ai/plugin` are all
**external** — the host provides them, and sharing one copy is what makes the plugin
work at all. Two traps hide here:

- A second `solid-js` is a second reactivity graph. The host mounts slot content on its
  own initial pass and skips an empty contribution; it can only re-mount later if the
  *same* graph sees the signal change. Bundling our own copy would make the update fire
  in an isolated graph the host's tree never reads — an empty footer even though the
  bundle proves itself "reactive".
- A second `@opentui/solid` (or `@opentui/core`) is a second renderer.

When installed from npm these all come in as peer dependencies. From a checkout, the
host's copy is picked up via its own `node_modules` resolution at load time.

Then register it in `~/.config/opencode/tui.json` (append — don't remove other
plugins):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/runcommand/integrations/opencode/dist/tui.js"]
}
```

Restart the OpenCode TUI.

### Finding the CLI

The plugin shells out to `runcommand`, and looks for it in two places: the
sibling checkout (`../../bin/runcommand.mjs`) when this directory lives inside the
repo, and otherwise plain `runcommand` on your `PATH`. So a clone works with no
setup, and a standalone install works as long as the CLI is installed too.
`RUNCOMMAND_CMD` overrides both.

Published as [`@amabush/runcommand-opencode`](https://www.npmjs.com/package/@amabush/runcommand-opencode),
so `"plugin": ["@amabush/runcommand-opencode/tui"]` works without a checkout — as long as
the CLI (`@amabush/runcommand`) is installed too. **The `/tui` suffix is required** in both
forms: `package.json` exports only `./tui`, so a bare package or directory path resolves
nothing and OpenCode silently loads no plugin.

## Config (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `RUNCOMMAND_CMD` | (auto) | Override how the CLI is invoked. Default: `../../bin/runcommand.mjs` under the current runtime when that sibling exists, else `runcommand` from `PATH`. |
| `RUNCOMMAND_OPENCODE_REFRESH_MS` | `5000` | How often the line re-reads state. |

Everything else (model, overrides, port filtering) is controlled by the CLI — see
the top-level [README](../../README.md).

## Notes

- The plugin only renders when there's something to show (run command, ports, or
  a "detecting…" state); otherwise the slot is empty.
- It reads the project directory from `api.state.path.directory`, so it follows
  you as you switch worktrees.
