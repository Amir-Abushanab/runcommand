// Signal collection on real (temp) directories — the nested fallback exists for
// projects like a macOS app whose Package.swift, xcodeproj, and run scripts all
// live one level below the repo root.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listManifests, listNestedSignals, isProjectContainer, collectSignals, signalsHash } from "../bin/runcommand.mjs";

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

// A directory that holds projects is not a project. Without this the nested
// fallback hands the model forty unrelated manifests and gets prose back.
test("isProjectContainer: sibling git repos mean the parent only holds projects", () => {
  const root = tmpProject({
    "anesthify/.git/HEAD": "ref: refs/heads/main",
    "anesthify/package.json": "{}",
    "barikly-web/.git/HEAD": "ref: refs/heads/main",
    "barikly-web/package.json": "{}",
    "notes.md": "loose file, not a project",
  });
  assert.equal(isProjectContainer(root), true);
  assert.deepEqual(collectSignals(root).nested, []);
});

test("isProjectContainer: three self-contained manifests count even without git", () => {
  const root = tmpProject({
    "one/package.json": "{}",
    "two/Cargo.toml": "[package]",
    "three/go.mod": "module three",
  });
  assert.equal(isProjectContainer(root), true);
});

test("isProjectContainer: a monorepo root is never a container", () => {
  // Its own .git returns early, so apps/* below it still feed detection.
  const root = tmpProject({
    ".git/HEAD": "ref: refs/heads/main",
    "web/package.json": '{"scripts":{"dev":"vite"}}',
    "api/go.mod": "module api",
    "worker/Cargo.toml": "[package]",
  });
  assert.equal(isProjectContainer(root), false);
  assert.deepEqual(collectSignals(root).nested, ["api/go.mod", "web/package.json", "worker/Cargo.toml"]);
});

test("isProjectContainer: the split-in-two project the nested fallback exists for", () => {
  // Two subdirs, neither its own repo — below both thresholds, so it detects.
  const root = tmpProject({ "App/Package.swift": "// swift-tools-version:6.0", "scripts/run.sh": "#!/bin/sh" });
  assert.equal(isProjectContainer(root), false);
  assert.deepEqual(collectSignals(root).nested, ["App/Package.swift", "scripts/run.sh"]);
});

test("signalsHash: a container's hash ignores the projects inside it", () => {
  const root = tmpProject({
    "one/.git/HEAD": "ref: refs/heads/main",
    "two/.git/HEAD": "ref: refs/heads/main",
  });
  const before = signalsHash(root);
  fs.mkdirSync(path.join(root, "three"), { recursive: true });
  fs.writeFileSync(path.join(root, "three", "package.json"), '{"scripts":{"dev":"vite"}}');
  assert.equal(signalsHash(root), before, "cloning another repo into ~/Code must not re-detect it");
});
