---
"@amabush/runcommand": patch
---

Document which surfaces can actually render a clickable `:PORT`, having measured them
rather than assumed.

tmux strips OSC 8 hyperlinks out of its status line — verified by capturing what tmux
writes to an attached client: the escape is stored verbatim in `status-right` and none of
it reaches the terminal. So the tmux recipe in the README now uses `runcommand ports
--urls`; the compact form would have rendered as unclickable text there.

Claude Code is the opposite case and is [documented as
such](https://code.claude.com/docs/en/statusline#clickable-links): OSC 8 links are a
supported status-line feature, which is what makes `compact` the right default there.
