---
"@amabush/runcommand": patch
---

`init` refuses to run through `pnpm dlx` or `bunx`, the same as npx

All three put `runcommand` on your PATH only until the command exits, so a status line
wired from inside one points at a `runcommand` that stops resolving the moment it
returns, and renders blank. npx was already caught. pnpm dlx slipped through because it
runs the package straight out of pnpm's store, which looks the same as a real pnpm
install. `init` now also checks the `runcommand` it finds on PATH, which dlx serves from
its cache. bunx is caught by its temp directory. Both get the same message as npx:
install it for real first.
