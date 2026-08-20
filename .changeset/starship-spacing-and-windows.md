---
"runcommand": minor
---

Fix the shell prompt swallowing the space after the runcommand segment, add Windows
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
