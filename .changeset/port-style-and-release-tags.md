---
"@amabush/runcommand": minor
---

Ports in the status line are short again: `:3423`, not `http://localhost:3423`.

`compact` is now the default everywhere. The status line defaulted to `url` to stay
clickable on surfaces that strip OSC 8 hyperlinks — but Claude Code's TUI passes OSC 8
straight through, so the long form bought nothing there and cost most of the line's width
once a project served more than one port. The one surface known to strip it, Qwen Code,
already gets `RUNCOMMAND_PORT_STYLE=url` written explicitly by `runcommand init`, and
that's unchanged. Set `RUNCOMMAND_PORT_STYLE=url` to get the old rendering back anywhere
else.
