---
"@amabush/runcommand": minor
---

Detect projects whose run signals don't live at the repo root — a Swift package in a
subdirectory, an Xcode project, an app two levels down, run scripts under `scripts/`.

Detection used to look at the root directory only, and whole ecosystems weren't
recognized at all, so a repo like a macOS app with `App/Package.swift`,
`UITests/*.xcodeproj`, and `scripts/*.sh` short-circuited to a cached "empty" — the
model was never even asked. Now:

- The manifest list covers far more ecosystems: Swift/Xcode (`Package.swift`,
  `*.xcodeproj`/`*.xcworkspace` by suffix), .NET (`*.csproj`/`*.fsproj`/`*.sln`),
  Gradle/Maven wrappers (`gradlew`, `mvnw`, `settings.gradle*`), Flutter
  (`pubspec.yaml`), Zig, sbt, Haskell, OCaml, Crystal, Erlang, Clojure, Bazel, Nix,
  Laravel (`artisan`), Rails (`config.ru`), Fastlane, Godot, Vagrant, `go.work`,
  `Taskfile.yaml`, and more.
- When the root shows nothing, a BFS scan two levels deep surfaces nested manifests
  and run scripts (`.sh`/`.ps1`/`.cmd`/`.bat` at the root or in `scripts/`, `bin/`,
  `tools/`, `hack/`, …), junk dirs skipped, shallower findings first, capped so a
  huge tree can't stall a render. The model is told these paths are relative to the
  root and the command must run from there (`swift run --package-path <dir> …`,
  `make -C <dir>`, …).
- The nested scan feeds `signalsHash` too, so stale "empty" caches self-invalidate
  and adding a nested manifest later triggers a re-detect.
- The scan honors the root `.gitignore` (exact names, anchored and directory
  patterns, `*`/`**`/`?` globs; negation ignored) — build outputs and generated
  trees are exactly where stale manifests live.
- Detection agents now start bare — no MCP servers, hooks, plugins, or
  extensions: `claude --strict-mcp-config --setting-sources ""`, `opencode
  --pure`, `qwen --safe-mode`, `gemini -e none`, `codex -c mcp_servers={}`. A
  repo whose `.mcp.json` boots pnpx-installed MCP servers, or whose hooks spawn
  binaries, could eat the whole 90s detect timeout on startup alone — and the
  answer then came from the next agent in the chain (a different model, often a
  worse answer). Detection needs none of that startup, just the model. A CLI too
  old for its flag exits non-zero — fast — and the chain moves on as before.
- `codex exec` also gets `--skip-git-repo-check`: it refuses directories it
  doesn't trust, so detection via codex silently fell through to the next agent
  in every repo the user hadn't approved.
- Monorepos whose root `dev` script only fans out to every workspace
  (`pnpm -r --parallel run dev`, `turbo run dev`) are steered back to labeled
  per-service commands (`web: … · api: …`).
