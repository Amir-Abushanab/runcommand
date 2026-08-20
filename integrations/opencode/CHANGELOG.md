# runcommand-opencode

## 0.2.0

### Minor Changes

- a152d5c: Make the OpenCode plugin publishable on its own, and fix it looking for the CLI in
  a place that only exists inside the repo.
  
  Renamed from `runcommand-opencode-plugin` and no longer `private`, so it can ship
  as its own package — which is what OpenCode users need, since the CLI's npm tarball
  contains only `bin/` and never carried the plugin.
  
  - **The plugin now finds the CLI either way.** It used to hardcode
    `../../bin/runcommand.mjs`, which resolves only when the directory sits inside a
    checkout. Installed anywhere else the spawn just failed and the footer rendered
    empty, with nothing on screen to say why. It now falls back to `runcommand` on
    `PATH`, and `RUNCOMMAND_CMD` still overrides both.
  - `@opencode-ai/plugin` moved to devDependencies — it's a type-only import and was
    never resolved at runtime.
  - `solid-js` and `@opentui/solid` stay **peer** dependencies, deliberately: a second
    copy of `solid-js` is a second reactive graph and a second `@opentui/solid` is a
    second renderer. Their ranges are no longer exact pins, which would have
    conflicted with whatever build of OpenTUI the host ships.
