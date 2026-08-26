# @amabush/runcommand-opencode

## 0.3.1

### Patch Changes

- [`907507d`](https://github.com/Amir-Abushanab/runcommand/commit/907507d4860d428c60f50555b2e29272570d05f5) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Document the registration form that actually works: a **path** to `dist/tui.js`, not the
  package name.
  
  `"plugin": ["@amabush/runcommand-opencode/tui"]` looks right and resolves fine from
  `~/.config/opencode` — but OpenCode resolves plugin specifiers from the project it is
  running in, where an installed package under the config directory is not on the resolution
  path. It is never found, and nothing says so: no error, no plugin, an empty footer.
  
  Install as before, then point `tui.json` at the file:
  
  ```json
  { "plugin": ["/Users/you/.config/opencode/node_modules/@amabush/runcommand-opencode/dist/tui.js"] }
  ```

## 0.3.0

### Minor Changes

- [`05f9982`](https://github.com/Amir-Abushanab/runcommand/commit/05f998288046dfc7b8a6d298c5117c69d24b1b02) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Build the plugin so it actually renders. The footer had always been empty: the plugin
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

### Patch Changes

- [`c23ab49`](https://github.com/Amir-Abushanab/runcommand/commit/c23ab495185508109d3def9c708c76daf47d4ec1) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Fix the plugin never loading — the footer stayed empty with nothing on screen to explain
  why. Two independent causes, either of which was enough on its own.
  
  **The JSX pragma.** The loader resolves `jsxImportSource` from the tsconfig it finds
  relative to its *working directory*, and OpenCode runs in your project — so the
  `tsconfig.json` sitting next to `tui.tsx` was never found. JSX compiled against React, the
  import died on `react/jsx-dev-runtime`, and the slot never registered. `tui.tsx` now
  carries a `/** @jsxImportSource @opentui/solid */` pragma, which is cwd-independent.
  Importing it from a project directory or `/tmp` now works; before, it only worked from the
  plugin's own directory.
  
  **The registration path.** `package.json` exports only `./tui`, but every example — this
  README, the file header, and the top-level README — showed the bare package or directory
  path, which resolves nothing. All of them now show the required `/tui` suffix:
  `"plugin": ["@amabush/runcommand-opencode/tui"]`.

- [`fd7efb4`](https://github.com/Amir-Abushanab/runcommand/commit/fd7efb4a9b056dc87e1360e12607e3ac63a2f413) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Fix peer ranges that made the published package impossible to install with npm.
  
  0.2.0 declared `solid-js: ^1.9.14` alongside `@opentui/solid: ^0.4.5` — but every
  published `@opentui/solid`, 0.4.5 through 0.5.4, peer-pins `solid-js` to exactly `1.9.12`.
  No version satisfies both, so `npm install @amabush/runcommand-opencode` failed outright
  with ERESOLVE; only `--force`/`--legacy-peer-deps` (or bun, which is laxer) got past it.
  
  `solid-js` is now `^1.9.12`, which the pin can satisfy, and `@opentui/solid` is `>=0.4.5`
  rather than `^0.4.5` — a caret on a 0.x range excludes the current 0.5.x, which is exactly
  the kind of host build a peer dependency is supposed to accept.

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
