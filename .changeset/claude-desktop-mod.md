---
"@amabush/runcommand": minor
---

`init` installs a Claude Code mod for the Claude desktop app, with auto-update on

The desktop app's Code tab runs Claude Code with no status line, so the run-command line
never showed there. A Claude Code mod, listed in this repository's new marketplace, now
draws it in the band above the prompt, ports still clickable. `init` offers it on a Mac
whose app has used its Code tab (elsewhere: `runcommand init --surfaces claude-desktop`). It
declares the marketplace in `~/.claude/settings.json` with auto-update on and enables the
mod, and Claude Code then fetches it, and each release after it, by itself. A `runcommand`
marketplace that init didn't declare is left alone, and `runcommand uninstall` turns the mod
off and takes the marketplace back.
