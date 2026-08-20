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

```sh
cd integrations/opencode
bun install            # self-contained (recommended for sharing)
```

Or, if you already run another OpenCode plugin, symlink its copies (no network):

```sh
# from an existing plugin's node_modules
ln -sfn /path/to/other-plugin/node_modules/solid-js       node_modules/solid-js
ln -sfn /path/to/other-plugin/node_modules/@opentui/solid node_modules/@opentui/solid
ln -sfn /path/to/other-plugin/node_modules/@opentui/core  node_modules/@opentui/core
```

Then register it in `~/.config/opencode/tui.json` (append — don't remove other
plugins):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/runcommand/integrations/opencode"]
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
so `"plugin": ["@amabush/runcommand-opencode"]` works without a checkout — as long as the
CLI (`@amabush/runcommand`) is installed too.

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
