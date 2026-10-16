---
"@amabush/runcommand": patch
---

`init` installs the desktop app's mod through Claude Code, so it shows in `claude plugin list`

`init` installed the Claude Code mod by writing its marketplace and its enabled entry to
`~/.claude/settings.json`. That's enough for the mod to load and update, but it leaves no
install record, and `claude plugin list` and `/plugin` list only installs, so the mod never
showed there. Where the `claude` CLI is on your PATH, `init` now installs it with `claude
plugin marketplace add` and `claude plugin install`, as `/plugin` would, then turns on the
marketplace's auto-update. Re-running `init` installs a mod an earlier `init` only declared,
and `runcommand uninstall` removes it the same way.
