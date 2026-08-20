---
"@amabush/runcommand-opencode": patch
---

Fix peer ranges that made the published package impossible to install with npm.

0.2.0 declared `solid-js: ^1.9.14` alongside `@opentui/solid: ^0.4.5` — but every
published `@opentui/solid`, 0.4.5 through 0.5.4, peer-pins `solid-js` to exactly `1.9.12`.
No version satisfies both, so `npm install @amabush/runcommand-opencode` failed outright
with ERESOLVE; only `--force`/`--legacy-peer-deps` (or bun, which is laxer) got past it.

`solid-js` is now `^1.9.12`, which the pin can satisfy, and `@opentui/solid` is `>=0.4.5`
rather than `^0.4.5` — a caret on a 0.x range excludes the current 0.5.x, which is exactly
the kind of host build a peer dependency is supposed to accept.
