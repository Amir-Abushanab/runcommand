---
"@amabush/runcommand": patch
---

Qwen Code gets clickable short ports too — it never stripped OSC 8.

`init` used to write `RUNCOMMAND_PORT_STYLE=url` into `~/.qwen/settings.json`, on the
belief that Qwen's TUI strips OSC 8 hyperlinks. Measured by capturing what Qwen writes to
an attached pty, it doesn't: the full hyperlink arrives at the terminal intact. So Qwen
now gets the same `compact` default as everything else.

Already wired for Qwen? `init` won't rewrite a status line it already recognises, so the
`url` prefix stays until you remove it by hand — it still works, it's just more verbose
than it needs to be.
