<p align="center">
  <img src="assets/logo.svg" width="84" height="84" alt="runcommand" />
</p>

<h1 align="center">runcommand</h1>

<p align="center">
  Your project's <strong>run command</strong> — and the localhost ports it's
  serving — in your status bar and shell prompt.<br/>
  LLM-detected once, cached, self-healing, and clickable.
</p>

**The problem:** you're juggling a dozen repos and every one starts differently —
`pnpm dev` here, `yarn dev` there, `cargo run`, `docker compose up`… You open a
project and have to dig through `package.json` (again) just to remember how to run
it. **runcommand** works it out and keeps it in front of you:

<p align="center">
  <img src="assets/shot-statusbar.png" width="720" alt="runcommand in the Claude Code status bar: ▶ pnpm dev with clickable ports :3000 :5173, beneath the existing status line" />
</p>

A quick `claude -p` call works out the command from your `package.json` scripts,
lockfile and manifests, **caches it per project**, and only re-asks when a manifest
changes — so the render never waits on the model (cache hit ~50ms; a miss shows
`▶ finding run command…` and detects in the background).

It's a tiny, **dependency-free** Node CLI (built-ins only) that speaks Claude
Code's status-line contract — so the same answer drops into **starship**,
**OpenCode**, **Qwen Code**, and more, and coexists with whatever already draws
your status line (see [Coexisting](#coexisting-with-another-status-line)).

> 🌐 **Showcase:** the [`site/`](site/) directory is an Astro page (run it locally
> with `pnpm site`) that deploys to `https://amir-abushanab.github.io/runcommand/`.

**Jump to:** [Install](#install) · [Claude Code](#wire-it-into-claude-code) · [Live ports](#live-localhost-ports) · [Shell prompt](#shell-prompt-starship) · [Other surfaces](#other-agents-and-prompts) · [Commands](#commands) · [Config](#config-env-vars) · [How it works](#how-detection-works)

## Requirements

- **Node** ≥ 18 (already present if you run Claude Code)
- The **`claude`** CLI on your `PATH` (used for detection)

## Install

Put `runcommand` on your `PATH` — simplest is a symlink into a dir that's already
there (e.g. `~/.local/bin`):

```sh
ln -sfn "$PWD/bin/runcommand.mjs" ~/.local/bin/runcommand   # from the repo root
```

Or install it globally: `npm i -g .`. Prefer not to install at all? Every command
below also works as `node bin/runcommand.mjs <command>`.

## Wire it into Claude Code

Add a `statusLine` to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "runcommand statusline",
    "padding": 0
  }
}
```

If you didn't link it, use the full path instead:

```json
"command": "node /ABSOLUTE/PATH/TO/runcommand/bin/runcommand.mjs statusline"
```

That's it. The first time you open each project the line reads
`▶ finding run command…` for a few seconds, then flips to the real command and
stays cached.

## Coexisting with another status line

Claude Code has exactly one `statusLine` slot, so to show **both** your existing
status line and the run-command line, one has to render the other. `runcommand`
supports this generically via `RUNCOMMAND_BASE` — set it to any command that
prints a status line, and `runcommand` renders that first, then its own line
beneath:

```json
{
  "statusLine": {
    "type": "command",
    "command": "RUNCOMMAND_BASE='your existing status line command here' runcommand statusline",
    "padding": 0
  }
}
```

`runcommand` passes the same Claude Code JSON (on stdin) through to the base
command, so anything that reads the standard `statusLine` contract just works. It
never modifies the other tool's config.

(The reverse also works: if your other tool can chain a child status line, point
*it* at `runcommand statusline` and leave `RUNCOMMAND_BASE` unset.)

## Overrides (instant, no model call)

To pin a project's command yourself — for anything the model gets wrong, or to
skip the model entirely — do either:

- Add a **`.claude-run`** file. One command per line; add a `label:` prefix
  (with a space) to name a service:
  ```
  make serve PORT=8080
  ```
  ```
  web: pnpm dev:web
  api: pnpm dev:api
  ```
- Or add a **`Run:`** line to the project's `CLAUDE.md` (only `CLAUDE.md`, and
  only outside code fences — so documentation examples like this one don't count):
  ```
  Run: docker compose up --build
  ```

Overrides win over the cache and cost nothing.

## Multiple run commands

Some repos run several services at once (a web app + an API, say). When that's the
case they render on **one compact line**, each in its own color:

<p align="center">
  <img src="assets/shot-monorepo.png" width="720" alt="multiple run commands on one line — web: pnpm dev:web · api: pnpm dev:api" />
</p>

Each service gets its own color (cycled from a colorblind-safe palette; tune it
with `RUNCOMMAND_COLORS`). A single-service project stays a single unlabeled entry
(`▶ pnpm dev`). The set is decided one of two ways:

- **Detected** — the model returns each genuinely-distinct long-running service
  (it won't split one app into build/lint/test). Nudge it with `--hint` if needed.
- **Pinned** — list them in `.claude-run`, one `label: command` per line (above).

## Live localhost ports

Alongside the run command, the status line shows the project's **currently running**
localhost servers, as clickable links:

```
▶ pnpm dev   ◉ :3000 :5173
```

Ports are found via `lsof` and **scoped to the project** — only listeners whose
process is running inside the project directory are shown (so postgres, docker,
and other machines' servers don't leak in). Ephemeral/internal ports (`≥ 49152`,
e.g. `workerd` plumbing) and debuggers (`9229`) are filtered out. The scan is
cached briefly (`RUNCOMMAND_PORTS_TTL_MS`, default 2.5s) so it stays cheap on the
status-line hot path. Set `RUNCOMMAND_NO_PORTS=1` to hide them.

**Clickability.** Ports are clickable via OSC 8 hyperlinks (⌘-click in Ghostty;
also iTerm2, WezTerm, kitty, VS Code). Two rendering styles, chosen per use and
overridable with `RUNCOMMAND_PORT_STYLE`:

- **`compact`** — short `:PORT` as an OSC 8 hyperlink. Used in the shell prompt,
  and it also works in **Claude Code's status bar** (confirmed: the TUI passes
  OSC 8 through). Set `RUNCOMMAND_PORT_STYLE=compact` on the status-line command
  to use it there.
- **`url`** — full `http://localhost:PORT` as visible text, which terminals
  auto-link even without OSC 8 support. The default for the status line, so it
  stays clickable on terminals that lack OSC 8 hyperlinks. More verbose.

## Shell prompt (starship)

<p align="center">
  <img src="assets/shot-starship.png" width="720" alt="runcommand as a starship prompt tagline: ~/Code/anesthify on main  ▶ pnpm dev · :5173" />
</p>

Show the run command + clickable ports in your shell prompt too. Add a custom
module to `~/.config/starship.toml`:

```toml
right_format = "${custom.runcommand}"

[custom.runcommand]
command = "runcommand promptline"   # or: node /path/to/bin/runcommand.mjs promptline
when = true
format = "$output"
shell = ["bash", "--noprofile", "--norc"]
```

`promptline` is non-blocking and outputs an empty string when there's nothing to
show, so the segment simply disappears in unrelated directories. (For oh-my-zsh or
a bare prompt, call the same command from a `precmd` hook.)

## Other agents and prompts

Same tool, different surfaces. `runcommand statusline` follows Claude Code's
status-line contract (session JSON on stdin → one line on stdout), which several
tools reuse.

**Oh My Posh** — a `command` segment, like the starship module (add to a block in
your theme; `properties` is being renamed to `options` upstream):

```json
{
  "type": "command",
  "style": "plain",
  "properties": { "shell": "bash", "command": "runcommand promptline" },
  "template": " {{ .Output }} "
}
```

**Qwen Code** — it copied Claude Code's `statusLine` contract, so it drops in.
Add to `~/.qwen/settings.json` (Qwen strips OSC 8, so `url` ports stay clickable):

```json
{ "ui": { "statusLine": {
  "type": "command",
  "command": "RUNCOMMAND_PORT_STYLE=url runcommand statusline"
} } }
```

**OpenCode** — no status-line command; it loads TUI plugins. A ready-made plugin
lives in [`integrations/opencode/`](integrations/opencode/) — it renders the run
command + clickable ports into the footer. See its README to install.

**Codex** — no command-backed status line yet (tracked in
[openai/codex#17827](https://github.com/openai/codex/issues/17827)). When it
ships, its contract is Claude Code's, so it's a one-block write to
`~/.codex/config.toml`:

```toml
[tui]
status_line = ["model-with-reasoning", "context-remaining", "current-dir", "custom"]

[tui.status_line_command]
command = "runcommand statusline"
refresh_interval_ms = 30000
timeout_ms = 1000
```

## Commands

```sh
runcommand statusline        # render run command + live ports (Claude Code calls this)
runcommand prompt [dir]      # plain run command for a shell prompt (non-blocking)
runcommand promptline [dir]  # run command + clickable ports, styled (for starship)
runcommand ports [dir]       # this project's live localhost ports (--links --json --all)
runcommand detect [dir]      # detect now (calls claude -p), print + cache
runcommand get [dir]         # print the cached command (detect if missing)
runcommand refresh [dir]     # re-detect and overwrite the cache
runcommand path [dir]        # print the cache file path
```

`dir` defaults to the current directory; the project root is resolved by walking
up to the nearest `package.json` / manifest / `.git`.

### Steering a wrong guess

If detection picks the wrong command, tell it what's wrong with `--hint`:

```sh
runcommand refresh --hint "it's picking the API; I want the web dev server"
# -> pnpm run dev:web
```

The note is **saved with the project** and reused on every later re-detect, so a
future manifest change won't regress to the wrong answer. Wipe it with
`runcommand refresh --clear-hint`. For a hard, exact pin, use an override instead
(below).

## Config (env vars)

| Var | Default | Purpose |
| --- | --- | --- |
| `RUNCOMMAND_MODEL` | `haiku` | Model used for detection (`claude -p --model`) |
| `RUNCOMMAND_BASE` | – | Another status-line command to render above ours |
| `RUNCOMMAND_ICON` | `▶` | Leading glyph (set empty to drop it) |
| `RUNCOMMAND_LABEL` | – | Text before the command, e.g. `run: ` |
| `RUNCOMMAND_COLORS` | `36,33,35,34,32` | Per-service colors (ANSI codes), cycled by position; colorblind-safe default. Set to one code (e.g. `36`) for a single color |
| `RUNCOMMAND_TTL_MS` | `0` (off) | Re-detect after this long even if the manifest is unchanged |
| `RUNCOMMAND_PORT_STYLE` | `url` (statusline) / `compact` (prompt) | `url` = full clickable `http://localhost:PORT`; `compact` = `:PORT` OSC 8 link |
| `RUNCOMMAND_NO_PORTS` | – | Hide live ports in the status line |
| `RUNCOMMAND_PORTS_TTL_MS` | `2500` | How long a port scan is cached (ms) |
| `RUNCOMMAND_IGNORE_PORTS` | `9229,9230` | Ports to never show (e.g. debuggers) |
| `RUNCOMMAND_CLAUDE` | – | Path to the `claude` binary (else auto-resolved) |
| `NO_COLOR` | – | Disable ANSI color |

## Where the cache lives, and for how long

`$XDG_CACHE_HOME/runcommand/` (falls back to `~/.cache/runcommand/`), one JSON
file per project, named `<sha1(project-root)>.json`.

There is **no time-based expiry** by default — a detected command is cached
*indefinitely*. It's invalidated by **content, not time**: each render hashes the
project's signals and re-detects (in the background) the moment they change. The
hash covers:

- `package.json` scripts and the `packageManager` field,
- the lockfile and the list of manifest files present,
- the **contents** of command-defining manifests — `Makefile`, `Justfile`,
  `Taskfile`, `Procfile`, `docker-compose*`, `Cargo.toml`, `pyproject.toml`,
  `composer.json`, `mix.exs`, `Gemfile`, `deno.json`,
- any `.claude-run` override, and a `Run:` line in `CLAUDE.md`.

So when an agent (or you) edits any of those, the command updates itself — no need
to remember to refresh. Otherwise the answer (and any saved `--hint`) persists
until you `refresh` it or delete the file.

Set `RUNCOMMAND_TTL_MS` to also re-detect after a fixed age regardless of
changes (off by default).

## How detection works

1. **Override?** `.claude-run` / `.runcommand` file, or a `Run:` line in
   `CLAUDE.md` (outside code fences) → used as-is.
2. Otherwise, collect signals — `package.json` scripts, the package manager (from
   the `packageManager` field or the lockfile), the list of manifest/config
   files, and a run hint from the README — and ask `claude -p` for the single
   dev/run command.
3. Cache it against a hash of those signals. Next render is a cache hit until the
   signals change.

## License

MIT
