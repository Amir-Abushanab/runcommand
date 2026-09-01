# @amabush/runcommand

## 0.5.1

### Patch Changes

- [#5](https://github.com/Amir-Abushanab/runcommand/pull/5) [`d378931`](https://github.com/Amir-Abushanab/runcommand/commit/d378931f30df56c5c3a08d3f61943b075a660259) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Don't detect a run command for a directory that only holds projects
  
  Opening `~/Code` (or `~/src`, `~/work`) rendered a run command it had no business
  having. The nested-signal fallback — meant for a project whose manifest lives one
  level down — walked into 100+ unrelated repos and handed the model 40 of their
  manifests as if they described one app. The model answered in English ("Once you
  clarify, I can provide the correct command for that project's dev setup."), and
  that sentence was cached and rendered as the command.
  
  Both halves are fixed:
  
  - A container directory is recognized (no `.git` and no manifest of its own, plus
    children that are each self-contained) and skipped — no model call, no run
    command, and no ports, since the ones listening belong to the projects inside it.
    `runcommand ports --all` still lists them. A monorepo is never caught: its root
    carries the `.git` or a workspace manifest.
  - A prose answer is no longer accepted as a command. Rejected on shape — sentence
    punctuation, length, English function words — so no vocabulary list has to keep
    up with how a given model phrases a refusal.
  
  Existing bad entries clear themselves: a container's signals hash no longer includes
  what is nested inside it, so the stale entry stops matching and the next render re-detects.

## 0.5.0

### Minor Changes

- [`688086a`](https://github.com/Amir-Abushanab/runcommand/commit/688086a3f9ecb0c074cc7a201201608deae97664) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Detect projects whose run signals don't live at the repo root — a Swift package in a
  subdirectory, an Xcode project, an app two levels down, run scripts under `scripts/`.
  
  Detection used to look at the root directory only, and whole ecosystems weren't
  recognized at all, so a repo like a macOS app with `App/Package.swift`,
  `UITests/*.xcodeproj`, and `scripts/*.sh` short-circuited to a cached "empty" — the
  model was never even asked. Now:
  
  - The manifest list covers far more ecosystems: Swift/Xcode (`Package.swift`,
    `*.xcodeproj`/`*.xcworkspace` by suffix), .NET (`*.csproj`/`*.fsproj`/`*.sln`),
    Gradle/Maven wrappers (`gradlew`, `mvnw`, `settings.gradle*`), Flutter
    (`pubspec.yaml`), Zig, sbt, Haskell, OCaml, Crystal, Erlang, Clojure, Bazel, Nix,
    Laravel (`artisan`), Rails (`config.ru`), Fastlane, Godot, Vagrant, `go.work`,
    `Taskfile.yaml`, and more.
  - When the root shows nothing, a BFS scan two levels deep surfaces nested manifests
    and run scripts (`.sh`/`.ps1`/`.cmd`/`.bat` at the root or in `scripts/`, `bin/`,
    `tools/`, `hack/`, …), junk dirs skipped, shallower findings first, capped so a
    huge tree can't stall a render. The model is told these paths are relative to the
    root and the command must run from there (`swift run --package-path <dir> …`,
    `make -C <dir>`, …).
  - The nested scan feeds `signalsHash` too, so stale "empty" caches self-invalidate
    and adding a nested manifest later triggers a re-detect.
  - The scan honors the root `.gitignore` (exact names, anchored and directory
    patterns, `*`/`**`/`?` globs; negation ignored) — build outputs and generated
    trees are exactly where stale manifests live.
  - Detection agents now start bare — no MCP servers, hooks, plugins, or
    extensions: `claude --strict-mcp-config --setting-sources ""`, `opencode
    --pure`, `qwen --safe-mode`, `gemini -e none`, `codex -c mcp_servers={}`. A
    repo whose `.mcp.json` boots pnpx-installed MCP servers, or whose hooks spawn
    binaries, could eat the whole 90s detect timeout on startup alone — and the
    answer then came from the next agent in the chain (a different model, often a
    worse answer). Detection needs none of that startup, just the model. A CLI too
    old for its flag exits non-zero — fast — and the chain moves on as before.
  - `codex exec` also gets `--skip-git-repo-check`: it refuses directories it
    doesn't trust, so detection via codex silently fell through to the next agent
    in every repo the user hadn't approved.
  - Monorepos whose root `dev` script only fans out to every workspace
    (`pnpm -r --parallel run dev`, `turbo run dev`) are steered back to labeled
    per-service commands (`web: … · api: …`).

- [`688086a`](https://github.com/Amir-Abushanab/runcommand/commit/688086a3f9ecb0c074cc7a201201608deae97664) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - One override file, not two: `.runcommand` is the name; `.claude-run` is no longer read.
  
  `.claude-run` never matched any real Claude Code convention — it only looked like one —
  and two names for the same file meant docs, help text, and muscle memory all had to carry
  both. The project is young enough to fix the mistake outright. If you have a
  `.claude-run` file, rename it to `.runcommand`; the contents are unchanged. Docs now also
  recommend committing the file — everyone who clones the repo gets the pinned command.

## 0.4.0

### Minor Changes

- [`1ccc16f`](https://github.com/Amir-Abushanab/runcommand/commit/1ccc16fbf2f733bfe1aa57892b1b5cc2e6f5049b) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Detect run commands with [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
  
  `RUNCOMMAND_AGENT=deepseek` runs `dsh --profile headless "<prompt>"` — the harness's own
  one-shot mode, which answers a single task, prints the final message and exits, which is
  exactly the shape detection needs. It joins the default chain after `codex`, so an
  installed `dsh` is picked up with no configuration.
  
  `RUNCOMMAND_MODEL` is ignored for this agent: the headless profile takes no per-call model
  flag, so the model comes from the booted profile (as with `amp` and `goose`).

- [`7e45973`](https://github.com/Amir-Abushanab/runcommand/commit/7e45973c3a56c30486ed7327a7e76b647d7fa79b) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Ports in the status line are short again: `:3423`, not `http://localhost:3423`.
  
  `compact` is now the default everywhere. The status line defaulted to `url` to stay
  clickable on surfaces that strip OSC 8 hyperlinks — but Claude Code's TUI passes OSC 8
  straight through, so the long form bought nothing there and cost most of the line's width
  once a project served more than one port. The one surface known to strip it, Qwen Code,
  already gets `RUNCOMMAND_PORT_STYLE=url` written explicitly by `runcommand init`, and
  that's unchanged. Set `RUNCOMMAND_PORT_STYLE=url` to get the old rendering back anywhere
  else.

### Patch Changes

- [`d27d7aa`](https://github.com/Amir-Abushanab/runcommand/commit/d27d7aa9ecc1d68c60414bda933be3d568fb9229) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Qwen Code gets clickable short ports too — it never stripped OSC 8.
  
  `init` used to write `RUNCOMMAND_PORT_STYLE=url` into `~/.qwen/settings.json`, on the
  belief that Qwen's TUI strips OSC 8 hyperlinks. Measured by capturing what Qwen writes to
  an attached pty, it doesn't: the full hyperlink arrives at the terminal intact. So Qwen
  now gets the same `compact` default as everything else.
  
  Already wired for Qwen? `init` won't rewrite a status line it already recognises, so the
  `url` prefix stays until you remove it by hand — it still works, it's just more verbose
  than it needs to be.

- [`24a6fbb`](https://github.com/Amir-Abushanab/runcommand/commit/24a6fbb525241ef3602803cc25a9dcf6f05aa648) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Document which surfaces can actually render a clickable `:PORT`, having measured them
  rather than assumed.
  
  tmux strips OSC 8 hyperlinks out of its status line — verified by capturing what tmux
  writes to an attached client: the escape is stored verbatim in `status-right` and none of
  it reaches the terminal. So the tmux recipe in the README now uses `runcommand ports
  --urls`; the compact form would have rendered as unclickable text there.
  
  Claude Code is the opposite case and is [documented as
  such](https://code.claude.com/docs/en/statusline#clickable-links): OSC 8 links are a
  supported status-line feature, which is what makes `compact` the right default there.

## 0.3.0

### Minor Changes

- [`640cfd1`](https://github.com/Amir-Abushanab/runcommand/commit/640cfd1659d9b8d7231b7addac44df14231eed89) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Fix the starship segment never appearing.
  
  **If you wired up starship with `runcommand init` before this release, re-run
  `runcommand init`** — it will offer to refresh the block in place. Upgrading the package
  alone can't fix it: the block lives in your `starship.toml`, and only `init` rewrites it.
  
  The generated `[custom.runcommand]` block had no `when` condition, and starship skips a
  custom module that declares none — so the segment rendered as nothing at all, with
  `promptline` never even spawned. Nothing errored, which is why it looked like a working
  install. The block now sets `when = true` and lets `promptline` decide for itself when to
  show something, which it already did (it prints an empty string outside a project).
  
  Found by installing from npm onto a clean machine — the only config that worked was one
  that had been written by hand with `when = true` already in it.

## 0.2.1

### Patch Changes

- [`162b77f`](https://github.com/Amir-Abushanab/runcommand/commit/162b77fdb83682b717435471c279683232714ecc) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Releases now run from CI. A changeset landing on `main` opens a "chore: version
  packages" PR; merging it publishes to npm, tags, and cuts the GitHub Release — no
  commands typed, no npm token stored. Publishing authenticates over OIDC (npm Trusted
  Publishing), so releases carry provenance attestations.

## 0.2.0

### Minor Changes

- bda7243: Fix the shell prompt swallowing the space after the runcommand segment, add Windows
  support, and give generated config blocks a version so they can be migrated.
  
  **If you wired up starship before this release, re-run `runcommand init`** — it will
  offer to refresh the block in place. Upgrading the package alone can't fix it: the
  line lives in your `starship.toml`, and only `init` rewrites that.
  
  - **starship: no more `:4321took 10s`.** starship trims a custom module's output, so
    the trailing space `promptline` emitted never survived and `cmd_duration` rendered
    flush against the ports. The separator now lives in the module format instead,
    `format = "($output )"`, as a conditional group so it disappears along with the
    segment in directories with nothing to show.
  - **`runcommand init` migrates its own blocks.** Generated blocks are fenced with a
    version-stamped marker (`# >>> runcommand v2 …`). Re-running `init` after an
    upgrade reports an out-of-date block and offers an in-place refresh — only the
    lines between the markers change, surrounding spacing is preserved, and the file
    is backed up first. Blocks written by earlier releases carry no version and are
    recognised as v1. A config you wired by hand has no markers and is never
    rewritten; `init` prints the change to make and leaves the file alone.
  - **Windows support** — best-effort and not yet run on real hardware. Ports come
    from `netstat -ano` instead of `lsof`; agent lookup honours `PATHEXT`, so `claude`
    resolves to `claude.cmd` rather than looking uninstalled; the starship block omits
    the bash shell pin; the cache lives under `%LOCALAPPDATA%`. Scoping ports to the
    project matches the process command line, because Windows exposes no process
    working directory to a plain CLI. See the README's Windows section.
  - **The detection cache is versioned.** An unrecognised schema is treated as a cache
    miss and re-detected, so caches can't be misread across versions. Upgrading
    re-detects each project once.

### Patch Changes

- 9620c08: `init` now refuses to wire anything when it's running through `npx`, and says what to
  run instead.
  
  npx puts its cache directory on `PATH` for exactly one invocation, so `runcommand`
  resolves while `init` is running and never again. `init` read that as "already
  installed", skipped offering the `~/.local/bin` symlink, and wrote a bare
  `runcommand statusline` into `settings.json` — a name that stopped existing the moment
  npx exited, leaving a status line that silently rendered nothing.
  
  Also: the Install section of the README now leads with a single command, since `init`
  already offers the PATH symlink itself — the manual `ln -sfn` step it used to open with
  was work `init` does for you.
- a152d5c: Condense the README and move the maintainer docs out of it.
  
  It had grown long enough that the parts people actually need — install, wiring,
  overrides — were buried under reference material. It's about a third shorter now,
  with nothing dropped that a user needs:
  
  - **Versioning and compatibility** and **Releasing** moved to `CONTRIBUTING.md` —
    they're rules for changing the formats, not for using the tool. The README keeps
    the one line that matters to a user: re-run `runcommand init` after upgrading.
  - **How detection works** removed; it restated the detection and cache sections.
  - Shell prompt, other agents, and ambient surfaces merged into one **Other
    surfaces** section (so `init`'s pointers to the old section names were updated).
  - The Zellij layout and the Windows platform table are now collapsed `<details>` —
    still there, just not in the way.
