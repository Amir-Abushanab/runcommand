// Signal collection on real (temp) directories — the nested fallback exists for
// projects like a macOS app whose Package.swift, xcodeproj, and run scripts all
// live one level below the repo root.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listManifests, listNestedSignals, collectSignals, signalsHash } from "../bin/runcommand.mjs";

function tmpProject(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runcommand-test-"));
  for (const [p, content] of Object.entries(layout)) {
    const full = path.join(root, p);
    if (content === null) fs.mkdirSync(full, { recursive: true });
    else { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, content); }
  }
  return root;
}

test("listManifests: matches Xcode bundles by suffix, exact names by name", () => {
  const root = tmpProject({ "MyApp.xcodeproj": null, "Package.swift": "// swift-tools-version:6.0" });
  assert.deepEqual(listManifests(root), ["Package.swift", "MyApp.xcodeproj"]);
});

test("listNestedSignals: finds manifests and run scripts one level down, skips junk", () => {
  const root = tmpProject({
    "App/Package.swift": "// swift-tools-version:6.0",
    "UITests/HostApp.xcodeproj": null,
    "scripts/build_app.sh": "#!/bin/sh",
    "scripts/notes.txt": "not a signal",
    "node_modules/pkg/package.json": "{}",
    "docs/Makefile": "help:",
    ".hidden/Cargo.toml": "[package]",
    "run.sh": "#!/bin/sh",
  });
  assert.deepEqual(listNestedSignals(root), [
    "run.sh",
    "App/Package.swift",
    "UITests/HostApp.xcodeproj",
    "scripts/build_app.sh",
  ]);
});

test("listNestedSignals: BFS two levels down, shallower findings first", () => {
  const root = tmpProject({
    "apps/web/package.json": "{}",
    "apps/api/main.py": "",
    "backend/Server.csproj": "<Project/>",
    "tools/release.ps1": "",
    "src/util/helper.sh": "not in a script dir — noise",
    "apps/web/src/deep/Makefile": "too deep",
  });
  assert.deepEqual(listNestedSignals(root), [
    "backend/Server.csproj",
    "tools/release.ps1",
    "apps/api/main.py",
    "apps/web/package.json",
  ]);
});

test("listNestedSignals: recognizes wrapper/CLI manifests like gradlew and artisan", () => {
  const root = tmpProject({ "android/gradlew": "#!/bin/sh", "backend/artisan": "#!/usr/bin/env php" });
  assert.deepEqual(listNestedSignals(root), ["android/gradlew", "backend/artisan"]);
});

test("listNestedSignals: honors the root .gitignore", () => {
  const root = tmpProject({
    ".gitignore": "# build output\ndist/\n/generated\napps/*/out\n*.tmp.sh\n!keep.sh\n",
    "dist/Makefile": "ignored — dist/ matches at any depth",
    "web/dist/package.json": "ignored — dist/ is unanchored",
    "generated/Cargo.toml": "ignored — anchored /generated",
    "apps/web/out": null,
    "apps/web/Package.swift": "kept",
    "scripts/oops.tmp.sh": "ignored — *.tmp.sh glob",
    "scripts/deploy.sh": "kept",
  });
  fs.writeFileSync(path.join(root, "apps/web/out/Makefile"), "ignored — apps/*/out");
  assert.deepEqual(listNestedSignals(root), [
    "scripts/deploy.sh",
    "apps/web/Package.swift",
  ]);
});

test("collectSignals: nested fallback only kicks in when the root shows nothing", () => {
  const bare = tmpProject({ "App/Package.swift": "// swift-tools-version:6.0" });
  assert.deepEqual(collectSignals(bare).nested, ["App/Package.swift"]);

  const js = tmpProject({ "package.json": '{"scripts":{"dev":"vite"}}', "App/Package.swift": "x" });
  assert.deepEqual(collectSignals(js).nested, []);
});

test("signalsHash: adding a nested manifest to an empty-root project re-detects", () => {
  const root = tmpProject({ "docs/README.md": "hi" });
  const before = signalsHash(root);
  fs.mkdirSync(path.join(root, "App"), { recursive: true });
  fs.writeFileSync(path.join(root, "App", "Package.swift"), "// swift-tools-version:6.0");
  assert.notEqual(signalsHash(root), before);
});
