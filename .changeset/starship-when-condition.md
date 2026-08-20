---
"@amabush/runcommand": minor
---

Fix the starship segment never appearing.

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
