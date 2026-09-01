---
"@amabush/runcommand": patch
---

Don't detect a run command for a directory that only holds projects

Opening `~/Code` (or `~/src`, `~/work`) rendered a run command it had no business
having. The nested-signal fallback — meant for a project whose manifest lives one
level down — walked into 100+ unrelated repos and handed the model 40 of their
manifests as if they described one app. The model answered in English ("Once you
clarify, I can provide the correct command for that project's dev setup."), and
that sentence was cached and rendered as the command.

Both halves are fixed:

- A container directory is recognized (no `.git` and no manifest of its own, plus
  children that are each self-contained) and skipped — no model call, no run
  command, and no ports, since the ones listening belong to the projects inside it.
  `runcommand ports --all` still lists them. A monorepo is never caught: its root
  carries the `.git` or a workspace manifest.
- A prose answer is no longer accepted as a command. Rejected on shape — sentence
  punctuation, length, English function words — so no vocabulary list has to keep
  up with how a given model phrases a refusal.

Existing bad entries clear themselves: a container's signals hash no longer includes
what is nested inside it, so the stale entry stops matching and the next render re-detects.
