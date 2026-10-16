# runcommand — Claude Code mod

Shows the project's run command and its live localhost ports in the **Claude desktop app**,
in the band directly above the prompt:

```
▶ pnpm dev · ◉ :3000 :5173
───────────────────────────
❯
```

The app's Code tab runs Claude Code with no status line, so the line runcommand draws in a
terminal never shows there. A [mod](https://code.claude.com/docs/en/plugins/mods/overview) is a
plugin whose code Claude Code calls as it runs, including each time it draws its own interface;
this one draws the line in the `AbovePrompt` band, which the app and the terminal both have.

Like the [OpenCode plugin](../opencode/), it is a thin adapter: it runs `runcommand json` every
five seconds (and as soon as a turn ends) and draws the parts it gets back. Detection, caching,
overrides, port scoping and filtering all stay in the one CLI, and a cache miss starts a
background detection exactly as the status line's does.

## Install

Needs the CLI installed as usual; then `init` installs the mod along with the rest:

```sh
pnpm add -g @amabush/runcommand && runcommand init
```

It offers the mod on a Mac whose Claude app has used its Code tab; elsewhere, name it:
`runcommand init --surfaces claude-desktop`. It writes two entries to `~/.claude/settings.json`
(this repository as the `runcommand` marketplace, with auto-update on, and
`runcommand@runcommand` enabled), and Claude Code fetches the mod in the background when a
session next starts. `runcommand uninstall` turns it off and takes the marketplace back.

By hand instead, at the prompt of a terminal session:

```
/plugin install runcommand --marketplace Amir-Abushanab/runcommand
```

Answer `y` to add the marketplace and pick the user scope. From a shell it is
`claude plugin install runcommand --marketplace Amir-Abushanab/runcommand`; in the desktop app,
where `/plugin` doesn't run, click **+** next to the prompt box, then **Plugins**, **Add
marketplace** with `Amir-Abushanab/runcommand`, then **Add plugin**. A mod installed at the user
scope loads in the app's sessions too. Then turn on its updates.

## Updates

Claude Code updates a plugin only from a marketplace with auto-update on, and leaves that off
for every marketplace but Anthropic's own. `runcommand init` turns it on; after a hand install,
turn it on yourself: `/plugin` → **Marketplaces** → **runcommand** → **Enable auto-update**.
Claude Code then checks within ten minutes of a session's first message, says `Plugin updated:
runcommand`, and loads the new version in the next session. Without it, update by hand with
`claude plugin update runcommand@runcommand`.

The mod and the CLI update separately. The mod runs whichever `runcommand` is installed, and
that one changes only when you run `pnpm add -g @amabush/runcommand@latest`.

## Where it draws

**The app only, by default.** In a terminal the status line already shows the line, and one
session shows it once. If your terminal's one status-line slot belongs to something else and
you'd rather not [chain](../../README.md#coexisting-with-another-status-line) runcommand into it,
turn on its **Show in the terminal too** option in `/config`: the band then draws the status line's own line, colors and OSC 8 port links
included. It yields to Claude Code's surveys, and keeps whatever other mods draw in the band
beneath it.

In the app the line is one Markdown line, the commands in code spans: the app makes a `Link`
clickable only for an `https:` URL, and a link in Markdown may be `http:`, so that is how
`:3000` stays clickable there. Per-service colors are a terminal thing and don't carry over.

## Finding the CLI

The app starts Claude Code with the PATH the app itself was started with, and opened from the
Dock that usually lacks what your shell profile adds: `~/.zshrc` is where pnpm, bun and the
Node version managers put their directories. So the mod looks in three places, in order:

1. **`RUNCOMMAND_CMD`**, when set: the command to run, quoted like a shell command, e.g.
   `"/opt/homebrew/bin/node /path/to/runcommand/bin/runcommand.mjs"`. Nothing else is tried.
2. **`runcommand` on Claude Code's own PATH.**
3. **Your login shell** (`$SHELL -ilc`, then zsh, then bash), asked once where it finds
   `runcommand`; the mod then runs that path with that shell's PATH, since a pnpm or npm shim
   runs `node` from PATH. A failed search is retried at most once a minute.

For the app, set `RUNCOMMAND_CMD` under `env` in `~/.claude/settings.json` if the shell route
doesn't find it.

## Settings

It reads the variables the status line reads to draw itself — `RUNCOMMAND_ICON`,
`RUNCOMMAND_LABEL`, `RUNCOMMAND_COLORS` (the sixteen basic codes; others keep the default
color) and `RUNCOMMAND_NO_PORTS` — from Claude Code's environment. In the app that is the
`env` block of `~/.claude/settings.json`, not your shell's.

## Developing

Load the folder in place rather than the installed copy:

```sh
claude --plugin-dir integrations/claude-code
```

An interactive session reloads it on save. For the app, which takes no flags, either name the
folder in `CLAUDE_CODE_PLUGIN_DIRS` under `env` in `~/.claude/settings.json`, or add the
checkout as a marketplace (`claude plugin marketplace add ~/path/to/runcommand`) and install
`runcommand@runcommand` from it: a folder marketplace is read from the folder itself, so
`/reload-plugins` picks up edits. `runcommand init` leaves a `runcommand` marketplace it
didn't declare alone, so it won't swap a checkout added this way for the GitHub one.

A change to the mod gets a `pnpm changeset` note for `@amabush/runcommand-claude-code`, a
private workspace package that exists only to be versioned: Claude Code replaces an installed
copy only when `plugin.json`'s version changes, and the Release workflow's `pnpm run version`
copies each bump into it (`scripts/sync-mod-version.mjs`; a test fails the build if the two
ever disagree). A change merged without one reaches new installs, since the marketplace
serves `main`, but no existing one.

```sh
claude plugin validate integrations/claude-code   # what it hooks, calls and reads, as the engine sees it
claude plugin test integrations/claude-code       # tests/, run against the engine itself
tsc -p integrations/claude-code                   # once Claude Code has loaded it and laid its types
```

`claude plugin validate` lists everything the mod touches: the clock, the session's directory
and surfaces, its own state, `$.process.run` (the CLI, and the shell probe) and the environment
variables above. It reads no prompt, tool call or transcript.
