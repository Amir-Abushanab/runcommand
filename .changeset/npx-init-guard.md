---
"runcommand": patch
---

`init` now refuses to wire anything when it's running through `npx`, and says what to
run instead.

npx puts its cache directory on `PATH` for exactly one invocation, so `runcommand`
resolves while `init` is running and never again. `init` read that as "already
installed", skipped offering the `~/.local/bin` symlink, and wrote a bare
`runcommand statusline` into `settings.json` — a name that stopped existing the moment
npx exited, leaving a status line that silently rendered nothing.

Also: the Install section of the README now leads with a single command, since `init`
already offers the PATH symlink itself — the manual `ln -sfn` step it used to open with
was work `init` does for you.
