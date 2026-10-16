#!/usr/bin/env node
/**
 * Copies the Claude Code mod's version from its package.json into its plugin.json.
 *
 * changesets bumps package.json, but Claude Code reads plugin.json: an installed copy is
 * replaced only when that version changes, so a release that bumped one and not the other
 * would reach nobody. `pnpm run version` (what the Release workflow runs) calls this right
 * after `changeset version`, and test/claude-mod.test.mjs fails the build if the two ever
 * disagree.
 *
 * Only the version's own line is rewritten; the rest of plugin.json keeps its formatting.
 */
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL("../integrations/claude-code/", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", dir), "utf8"));
const file = new URL(".claude-plugin/plugin.json", dir);
const text = readFileSync(file, "utf8");
const was = JSON.parse(text).version;

if (was !== version) {
  const next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  // The first "version" in the file is the manifest's own; this catches the day it isn't.
  if (JSON.parse(next).version !== version) {
    throw new Error(`could not set plugin.json's version to ${version}; set it by hand`);
  }
  writeFileSync(file, next);
  console.log(`integrations/claude-code/.claude-plugin/plugin.json: version ${was} → ${version}`);
}
