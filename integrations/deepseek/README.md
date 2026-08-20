# runcommand — DeepSeek Harness plugin

Shows the project's run command + **clickable** live localhost ports in the
DeepSeek Harness web UI, as an ambient row under the composer:

```
▶ pnpm dev   ◉ :3000 :5173
```

dsh has no "status line" setting. It composes [Cordis](https://github.com/deepseek-ai/deepseek-harness)
plugins, and a plugin seats UI in a named Slot. This one takes
`conversation.composer.dock` — the band under the composer card, which dsh's own
slot contract calls *"the seat for an ambient readout about the conversation"*
(the shipped stats line sits there too). That makes it the direct counterpart to
Claude Code's status line and OpenCode's TUI footer.

**This renders in the dsh web app** (`dsh web`), not in your terminal — dsh has no
TUI. For a terminal status line use the starship, tmux or Claude Code surfaces
instead; see the top-level [README](../../README.md).

No detection logic lives here. The host half shells out to `runcommand json`, so
caching, project scoping, port filtering and LLM detection all stay in the one
CLI — the same split as the [OpenCode plugin](../opencode/README.md).

## Install

```sh
dsh plugin --profile web add runcommand-dsh
```

That's the whole install. The package declares `dsh.bundle.patch`, so its row
mounts itself — no hand-edited user patch layer. The browser half is **not** a row
of its own: dsh scans enabled entries for `dsh.client` packages and ships their
`exports["./client"]` to the page itself.

Check the composed tree before booting if you like — this prints exactly what
`boot()` would mount, and warns about a patch that matched no row:

```sh
dsh --profile web --dump-config | grep -A2 runcommand
```

Then `dsh web`.

## How the two halves talk

A browser can't spawn a process, so the host row registers one exact HTTP route
(`/runcommand`) on dsh's own `webServer` service and shells out to `runcommand
json`; the client polls it with `fetch`. It is deliberately **not** an api-gateway
Remote — those are a generated, typed BFF, and a third-party row shouldn't need
their codegen to publish one read-only value.

The client bundle is hand-written in dsh's shape —
`window.__ModuleLoader__.load({ id, factory })`, plain CJS inside the factory,
`id` being the package name — rather than emitted by their build.

## Config (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `RUNCOMMAND_CMD` | (auto) | Override how the CLI is invoked. Default: `../../bin/runcommand.mjs` under the current runtime when that sibling exists, else `runcommand` from `PATH`. |

Everything else (detection agent, model, overrides, port filtering) is controlled
by the CLI — see the top-level [README](../../README.md).

## Notes

- The row renders nothing when there's no command and no ports, so it costs no
  vertical space in an unrelated workspace.
- Ports are ordinary `<a href>` links to `http://localhost:PORT`. The slot
  contract asks that anything the user *must* click live in the tool row instead;
  these are an affordance on an ambient readout, not the point of it.
- It polls the host every 5s. That's a spawn behind runcommand's own disk cache,
  which is why the interval can be that short.
