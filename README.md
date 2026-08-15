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

A quick headless LLM call (Claude Code's `claude -p` by default — or [any agent you
configure](#detection-agent)) works out the command from your `package.json` scripts,
lockfile and manifests, **caches it per project**, and only re-asks when a manifest
changes — so the render never waits on the model (cache hit ~50ms; a miss shows
`▶ finding run command…` and detects in the background).

It's a tiny, **dependency-free** Node CLI (built-ins only) that speaks Claude
Code's status-line contract — so the same answer drops into **starship**,
**OpenCode**, **Qwen Code**, and more, and coexists with whatever already draws
your status line (see [Coexisting](#coexisting-with-another-status-line)).

> 🌐 **Showcase:** the [`site/`](site/) directory is an Astro page (run it locally
> with `pnpm site`) that deploys to `https://amir-abushanab.github.io/runcommand/`.

**Jump to:** [Install](#install) · [Claude Code](#wire-it-into-claude-code) · [Detection agent](#detection-agent) · [Live ports](#live-localhost-ports) · [Shell prompt](#shell-prompt-starship) · [Other surfaces](#other-agents-and-prompts) · [tmux & ambient](#terminal-multiplexers--ambient-surfaces) · [Commands](#commands) · [Config](#config-env-vars) · [How it works](#how-detection-works)

## Requirements

- **Node** ≥ 18 (already present if you run Claude Code)
- An **AI CLI for detection** on your `PATH` — [`claude`](https://claude.com/claude-code) (Claude Code) by default; OpenCode, Gemini CLI, Qwen Code, or Codex work too (see [Detection agent](#detection-agent))

## Install

Put `runcommand` on your `PATH` — simplest is a symlink into a dir that's already
there (e.g. `~/.local/bin`):

```sh
ln -sfn "$PWD/bin/runcommand.mjs" ~/.local/bin/runcommand   # from the repo root
```

Or install it globally: `npm i -g .`. Prefer not to install at all? Every command
below also works as `node bin/runcommand.mjs <command>`.

**Fastest setup — `runcommand init`:** it detects the tools you actually have
(Claude Code, Qwen Code, starship, tmux), wires each one for you, backs up every file
it touches, and preserves any status line you already run. Preview with
`runcommand init --dry-run`; undo everything with `runcommand uninstall`. The sections
below are the manual equivalents.

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

## Detection agent

Detection is just a headless LLM call: runcommand hands your project's signals to an
AI CLI and reads the command back. It tries agents in priority order and uses the
**first that's installed and answers** — so uninstalling Claude Code silently falls
through to whatever else is on the machine, and you never *need* any specific agent.
(This is about *which AI figures out the command*, separate from [which tools display
it](#other-agents-and-prompts).)

The default order is `claude → opencode → gemini → qwen → codex → cursor → crush → amp → llm → sgpt`, then the agentic last-resorts `aider → goose → copilot`. Pin or reorder with
`RUNCOMMAND_AGENT` — a single value forces one agent, a comma-separated list sets the
priority chain (e.g. `RUNCOMMAND_AGENT=opencode,claude`). A broken agent (exits non-zero)
also falls through to the next; a clean "no run command" answer does not:

| `RUNCOMMAND_AGENT` | Runs | Needs on `PATH` |
| --- | --- | --- |
| `claude` *(default)* | `claude -p "<prompt>" --model haiku` | [Claude Code](https://claude.com/claude-code) |
| `opencode` | `opencode run "<prompt>"` | [OpenCode](https://opencode.ai) |
| `gemini` | `gemini -p "<prompt>"` | [Gemini CLI](https://github.com/google-gemini/gemini-cli) |
| `qwen` | `qwen -p "<prompt>"` | [Qwen Code](https://github.com/QwenLM/qwen-code) |
| `codex` | `codex exec "<prompt>"` | [Codex CLI](https://github.com/openai/codex) |
| `cursor` | `cursor-agent -p --output-format text "<prompt>"` | [Cursor CLI](https://cursor.com/docs/cli/headless) |
| `crush` | `crush run -q "<prompt>"` | [Charm Crush](https://github.com/charmbracelet/crush) |
| `amp` | `amp -x "<prompt>"` | [Amp](https://ampcode.com) |
| `llm` | `llm "<prompt>"` | [llm](https://llm.datasette.io) |
| `sgpt` | `sgpt "<prompt>"` | [Shell GPT](https://github.com/TheR1D/shell_gpt) |
| `aider`† | `aider --yes --no-auto-commits --message "<prompt>"` | [Aider](https://aider.chat) |
| `goose`† | `goose run --no-session -t "<prompt>"` | [goose](https://block.github.io/goose/) |
| `copilot`† | `copilot -p "<prompt>"` | [Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli) |
| `ollama`\* | `ollama run <model> "<prompt>"` | [Ollama](https://ollama.com) — local |

<sub>† Agentic — `aider` edits files, `goose` runs tools, `copilot` is auth/confirmation-gated — so they sit **last** in the default chain (reached only when nothing cleaner is installed, i.e. it genuinely is your agent) with side-effect-minimizing flags. Prefer pinning a cleaner agent.</sub><br/>
<sub>\* Ollama is **never** in the default chain (`ollama run` pulls a multi-GB model on first use). Opt in explicitly: `RUNCOMMAND_AGENT=ollama RUNCOMMAND_MODEL=llama3.2`. All of these are **detection-only** — of the terminal AI tools, only Claude Code and Qwen Code expose a config-based status line. For everything else, show the line via an **ambient surface** instead (see [Terminal multiplexers & ambient surfaces](#terminal-multiplexers--ambient-surfaces)).</sub>

```json
{
  "statusLine": {
    "type": "command",
    "command": "RUNCOMMAND_AGENT=opencode runcommand statusline"
  }
}
```

`RUNCOMMAND_MODEL` overrides the model (passed as that agent's model flag); leave it
unset for anything but `claude` to use the agent's own default. For claude it defaults
to `haiku`.

Run **`runcommand agents`** anytime to see the resolved chain — which agents are
installed and which one wins. Add `--probe` to actually call each and confirm it
responds (installed ≠ authenticated/working):

```text
Will try, in order:
  1. claude    ~/.local/bin/claude       (model: haiku)
  2. opencode  /opt/homebrew/bin/opencode (model: agent default)
Not installed: gemini, qwen, codex
```

**Any other CLI?** Point `RUNCOMMAND_DETECT_CMD` at any command that takes a prompt and
prints the model's answer to stdout. runcommand appends the prompt as the final argument
(or substitutes it for a `{}` placeholder), so quoting is never your problem:

```sh
RUNCOMMAND_DETECT_CMD="my-llm --fast"          # runs: my-llm --fast "<prompt>"
RUNCOMMAND_DETECT_CMD="my-llm --prompt {} -q"  # runs: my-llm --prompt "<prompt>" -q
```

The agent only has to emit the command in `<cmd></cmd>` tags (the prompt tells it how);
caching, ports, and self-healing are unchanged. Use `RUNCOMMAND_AGENT_BIN` to point at a
specific binary when it isn't on the status line's `PATH`.

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
  <img src="assets/shot-starship.png" width="720" alt="runcommand as a starship prompt tagline: ~/Code/principlestash.com on main  ▶ pnpm dev · :5173" />
</p>

Show the run command + clickable ports in your shell prompt too. Add a custom
module to `~/.config/starship.toml`:

```toml
[custom.runcommand]
command = "runcommand promptline"   # or: node /path/to/bin/runcommand.mjs promptline
format = "$output"
shell = ["bash", "--noprofile", "--norc"]
ignore_timeout = true
```

`promptline` is non-blocking and outputs an empty string when there's nothing to
show, so the segment simply disappears in unrelated directories. Starship renders
custom modules inline by default; for a right-aligned tagline add
`right_format = "${custom.runcommand}"`. (`ignore_timeout` keeps a cold port scan
from tripping starship's 500 ms command cap. For oh-my-zsh or a bare prompt, call
the same command from a `precmd` hook.) This is exactly what `runcommand init` writes.

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

## Terminal multiplexers & ambient surfaces

Some tools — **aider**, **goose**, **Cursor**, **Codex**, GitHub **Copilot** — are
full-screen TUIs with no status-line hook, so runcommand can't render *inside* them. It
doesn't need to: an **ambient surface** shows the line *around* whatever's running, so it
works for any tool in your terminal.

**tmux** — put the run command in the status bar; it stays visible the whole time you're
inside aider/goose/etc., and tracks the active pane's project. **`runcommand init` wires
this for you** — it appends with `set -ga` so your existing `status-right` (clock, etc.)
is kept, not clobbered. The manual equivalent:

```tmux
# ~/.tmux.conf
set -ga status-right " #(runcommand prompt -C '#{pane_current_path}')"
```

`runcommand prompt` prints the plain command (and nothing in non-project dirs, so the
segment just disappears). Append live ports with `#(runcommand ports -C '#{pane_current_path}')`.

**Zellij** — its built-in status bar can't run commands, so use the
[`zjstatus`](https://github.com/dj95/zjstatus) plugin's `command_*` fields pointed at
`runcommand prompt`.

**Terminal title** — a universal fallback (shows in the tab/title bar even with no
multiplexer, though some TUIs overwrite it). From a shell hook:

```sh
# zsh precmd() or bash PROMPT_COMMAND
printf '\033]0;%s\007' "$(runcommand prompt)"
```

And the **shell prompt** ([starship](#shell-prompt-starship), Oh My Posh) is itself an
ambient surface — it shows the line before you launch the tool.

## Commands

```sh
runcommand statusline        # render run command + live ports (Claude Code calls this)
runcommand prompt [dir]      # plain run command for a shell prompt (non-blocking)
runcommand promptline [dir]  # run command + clickable ports, styled (for starship)
runcommand ports [dir]       # this project's live localhost ports (--links --json --all)
runcommand detect [dir]      # detect now (asks the configured agent), print + cache
runcommand get [dir]         # print the cached command (detect if missing)
runcommand refresh [dir]     # re-detect and overwrite the cache
runcommand path [dir]        # print the cache file path
runcommand init              # wire runcommand into your installed tools (--yes --dry-run --surfaces)
runcommand uninstall         # remove that wiring (restores what was there; --dry-run)
runcommand agents            # show the detection chain — which agents are installed (--probe to test each)
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
| `RUNCOMMAND_AGENT` | *(auto)* | Detection agent priority list, tried in order, first installed wins — e.g. `opencode,claude`. Default: `claude,opencode,gemini,qwen,codex,cursor,crush,amp,llm,sgpt,aider,goose,copilot` (plus `ollama`, opt-in; see [Detection agent](#detection-agent)) |
| `RUNCOMMAND_DETECT_CMD` | – | Full custom detect command; the prompt is appended, or put where `{}` appears |
| `RUNCOMMAND_AGENT_BIN` | – | Path to the agent binary (else auto-resolved) |
| `RUNCOMMAND_MODEL` | `haiku`\* | Detection model (\*`haiku` for `claude`; the agent's own default otherwise) |
| `RUNCOMMAND_BASE` | – | Another status-line command to render above ours |
| `RUNCOMMAND_ICON` | `▶` | Leading glyph (set empty to drop it) |
| `RUNCOMMAND_LABEL` | – | Text before the command, e.g. `run: ` |
| `RUNCOMMAND_COLORS` | `36,33,35,34,32` | Per-service colors (ANSI codes), cycled by position; colorblind-safe default. Set to one code (e.g. `36`) for a single color |
| `RUNCOMMAND_TTL_MS` | `0` (off) | Re-detect after this long even if the manifest is unchanged |
| `RUNCOMMAND_PORT_STYLE` | `url` (statusline) / `compact` (prompt) | `url` = full clickable `http://localhost:PORT`; `compact` = `:PORT` OSC 8 link |
| `RUNCOMMAND_NO_PORTS` | – | Hide live ports in the status line |
| `RUNCOMMAND_PORTS_TTL_MS` | `2500` | How long a port scan is cached (ms) |
| `RUNCOMMAND_IGNORE_PORTS` | `9229,9230` | Ports to never show (e.g. debuggers) |
| `RUNCOMMAND_CLAUDE` | – | Path to the `claude` binary (alias for `RUNCOMMAND_AGENT_BIN` when the agent is `claude`) |
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
   files, and a run hint from the README — and ask the [detection agent](#detection-agent)
   (`claude -p` by default) for the single dev/run command.
3. Cache it against a hash of those signals. Next render is a cache hit until the
   signals change.

## License

MIT
