---
"@amabush/runcommand-opencode": minor
---

Ship a bundled build, which is what finally makes the footer render.

The plugin loaded, registered its slot and drew exactly once — with no data — then never
updated. The cause was dependency resolution, not the plugin's logic: `solid-js` exports
`dist/server.js` under the `node` condition, and that server-rendering build never runs
effects. So the signal that `fetchRun()` sets could never repaint the slot. Nothing
errored, which is why it looked like the plugin simply wasn't loading.

`tui.tsx` is now bundled with `bun build --conditions=browser`, which pins solid-js to its
client build and inlines it (verified reactive: the same signal that never fired under
`server.js` re-renders under the client build). `@opentui/core` stays external — the host
owns the renderer — and is now declared as a peer dependency so it resolves.

`exports` points at `dist/tui.js`; `prepublishOnly` builds it, and the release workflow
installs bun so publishing produces the bundle.
