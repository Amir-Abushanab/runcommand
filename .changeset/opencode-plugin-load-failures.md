---
"@amabush/runcommand-opencode": patch
---

Fix the plugin never loading — the footer stayed empty with nothing on screen to explain
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
