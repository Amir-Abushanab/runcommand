// The Claude Code mod (integrations/claude-code): how it's released, and how init installs it.
//
// Claude Code replaces an installed copy only when plugin.json's version changes, while
// changesets bumps package.json. `pnpm run version` copies one into the other
// (scripts/sync-mod-version.mjs); IF THE FIRST TEST FAILS, a release would bump the
// package and reach no install. Run `node scripts/sync-mod-version.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { planDesktopMod, withDesktopMod, planDesktopModRemoval } from "../bin/runcommand.mjs";

const readJson = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const manifest = readJson("../integrations/claude-code/.claude-plugin/plugin.json");

test("the mod's plugin.json carries its package's version", () => {
  assert.equal(manifest.version, readJson("../integrations/claude-code/package.json").version);
});

test("the marketplace lists the mod under the id init enables", () => {
  const market = readJson("../.claude-plugin/marketplace.json");
  const entry = market.plugins.find((p) => p.name === "runcommand");
  // runcommand@runcommand: the entry's name, then the marketplace's.
  assert.equal(market.name, "runcommand");
  assert.equal(manifest.name, "runcommand");
  assert.equal(entry.source, "./integrations/claude-code");
});

const OURS = { source: { source: "github", repo: "Amir-Abushanab/runcommand" }, autoUpdate: true };

test("planDesktopMod: installs where nothing is declared, and is a no-op once it is", () => {
  assert.deepEqual(planDesktopMod({}), { action: "add" });
  assert.deepEqual(planDesktopMod(withDesktopMod({})), { action: "none" });
});

test("planDesktopMod: turns auto-update back on, and the mod back on", () => {
  const off = { extraKnownMarketplaces: { runcommand: { ...OURS, autoUpdate: false } }, enabledPlugins: { "runcommand@runcommand": true } };
  assert.deepEqual(planDesktopMod(off), { action: "update" });
  const disabled = { extraKnownMarketplaces: { runcommand: OURS }, enabledPlugins: { "runcommand@runcommand": false } };
  assert.deepEqual(planDesktopMod(disabled), { action: "update" });
});

test("planDesktopMod: never replaces a marketplace of the same name from somewhere else", () => {
  // e.g. a checkout added with `claude plugin marketplace add` while working on the mod
  const local = { extraKnownMarketplaces: { runcommand: { source: { source: "directory", path: "/src/runcommand" } } } };
  assert.equal(planDesktopMod(local).action, "refused");
  assert.match(planDesktopMod(local).reason, /\/src\/runcommand/);
  const fork = { extraKnownMarketplaces: { runcommand: { source: { source: "github", repo: "someone/runcommand" } } } };
  assert.equal(planDesktopMod(fork).action, "refused");
  assert.equal(planDesktopMod({ enabledPlugins: ["runcommand@runcommand"] }).action, "refused");
});

test("planDesktopMod: knows this repository however it's spelled", () => {
  for (const source of [
    { source: "github", repo: "amir-abushanab/runcommand" },
    { source: "github", repo: "Amir-Abushanab/runcommand", ref: "main" },
    { source: "git", url: "https://github.com/Amir-Abushanab/runcommand.git" },
    { source: "git", url: "git@github.com:Amir-Abushanab/runcommand.git" },
  ]) {
    assert.equal(planDesktopMod({ extraKnownMarketplaces: { runcommand: { source } } }).action, "update", JSON.stringify(source));
  }
});

test("withDesktopMod: writes only its own two entries", () => {
  const settings = {
    statusLine: { type: "command", command: "x" },
    enabledPlugins: { "other@market": false },
    extraKnownMarketplaces: { market: { source: { source: "github", repo: "o/r" } } },
    env: { A: "1" },
  };
  const next = withDesktopMod(settings);
  assert.deepEqual(Object.keys(next), Object.keys(settings)); // nothing moved
  assert.deepEqual(next.statusLine, settings.statusLine);
  assert.deepEqual(next.env, settings.env);
  assert.deepEqual(next.enabledPlugins, { "other@market": false, "runcommand@runcommand": true });
  assert.deepEqual(next.extraKnownMarketplaces, { ...settings.extraKnownMarketplaces, runcommand: OURS });
  // A declaration that's already ours keeps its own fields (a pinned ref, say).
  const pinned = { source: { source: "github", repo: "Amir-Abushanab/runcommand", ref: "v1" } };
  assert.deepEqual(withDesktopMod({ extraKnownMarketplaces: { runcommand: pinned } }).extraKnownMarketplaces.runcommand, { ...pinned, autoUpdate: true });
});

test("planDesktopModRemoval: turns the mod off and takes back only our marketplace", () => {
  const installed = withDesktopMod({ env: { A: "1" }, extraKnownMarketplaces: { market: { source: { source: "github", repo: "o/r" } } } });
  const r = planDesktopModRemoval(installed);
  assert.equal(r.action, "remove");
  // false, not deleted: an installed plugin no settings file names starts enabled.
  assert.equal(r.settings.enabledPlugins["runcommand@runcommand"], false);
  assert.deepEqual(r.settings.extraKnownMarketplaces, { market: { source: { source: "github", repo: "o/r" } } });
  assert.deepEqual(r.settings.env, { A: "1" });
  // The marketplaces object init created goes with it.
  assert.equal("extraKnownMarketplaces" in planDesktopModRemoval(withDesktopMod({})).settings, false);
});

test("planDesktopModRemoval: leaves alone what init didn't add", () => {
  assert.deepEqual(planDesktopModRemoval({}), { action: "none" });
  const local = {
    extraKnownMarketplaces: { runcommand: { source: { source: "directory", path: "/src/runcommand" } } },
    enabledPlugins: { "runcommand@runcommand": true },
  };
  assert.deepEqual(planDesktopModRemoval(local), { action: "foreign", from: "/src/runcommand" });
});
