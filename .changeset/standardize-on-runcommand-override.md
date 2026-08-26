---
"@amabush/runcommand": minor
---

One override file, not two: `.runcommand` is the name; `.claude-run` is no longer read.

`.claude-run` never matched any real Claude Code convention — it only looked like one —
and two names for the same file meant docs, help text, and muscle memory all had to carry
both. The project is young enough to fix the mistake outright. If you have a
`.claude-run` file, rename it to `.runcommand`; the contents are unchanged. Docs now also
recommend committing the file — everyone who clones the repo gets the pinned command.
