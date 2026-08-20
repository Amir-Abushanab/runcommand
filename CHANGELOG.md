# @amabush/runcommand

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
