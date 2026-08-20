---
"@amabush/runcommand-opencode": minor
---

Build the plugin so it actually renders. The footer had always been empty: the plugin
loaded, registered its slot, drew once with no data, and never updated again — with
nothing on screen or in any log to say why.

Two things were needed, and either one missing produced that same silent nothing.

**Solid's reactivity is a compile-time transform.** It rewrites `when={shown()}` into
`get when() { … }` so the prop is re-read when the signal changes; bun's built-in JSX
transform evaluates props eagerly, freezing the view at its startup values. `@opentui/solid`
ships that transform as a bun plugin, which `bun build` only accepts through its JS API —
hence `build.mjs`.

**The host owns the runtime.** `solid-js`, `@opentui/solid` and `@opentui/core` are all
external. Bundling Solid gives the plugin its own reactive graph and its own renderer, so
the elements it builds aren't the ones OpenCode can paint. Sharing the host's instances is
what makes the slot mount — and keeps the bundle ~7 KB rather than ~106 KB.

Also: the source moved to `src/`, so a path registration can't silently resolve to the
unbundled `tui.tsx`; `exports` points at `dist/tui.js`; `prepublishOnly` builds it; and the
release workflow installs bun so a publish can't ship an unbuilt package. Tracing is
available with `RUNCOMMAND_OPENCODE_DEBUG=/tmp/rc.log`.
