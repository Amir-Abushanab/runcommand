---
"@amabush/runcommand": minor
---

Detect run commands with [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

`RUNCOMMAND_AGENT=deepseek` runs `dsh --profile headless "<prompt>"` — the harness's own
one-shot mode, which answers a single task, prints the final message and exits, which is
exactly the shape detection needs. It joins the default chain after `codex`, so an
installed `dsh` is picked up with no configuration.

`RUNCOMMAND_MODEL` is ignored for this agent: the headless profile takes no per-call model
flag, so the model comes from the booted profile (as with `amp` and `goose`).
