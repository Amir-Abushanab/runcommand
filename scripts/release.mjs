#!/usr/bin/env node
/**
 * Guarded publish: publishes only the package versions npm doesn't already have, driving
 * `pnpm publish` directly rather than `changeset publish`.
 *
 * Why not just `changeset publish`: changesets/action learns what was published by scanning
 * the publish command's stdout for `New tag: <pkg>@<version>` lines. Under pnpm those lines
 * never appear — `changeset publish` delegates to `pnpm publish`, which prints its own UI
 * ("Successfully published:", "Created git tags.") instead. The packages reach npm and the
 * tags are created locally, but the action sees zero published packages, so it pushes no
 * tags and cuts no GitHub Releases. That is exactly what happened to 0.2.1 and 0.3.0.
 *
 * `changeset publish` is only a wrapper around `pnpm publish` (which performs npm OIDC
 * trusted publishing) plus a local `git tag` per published package, so we do both directly
 * and print the line the action is looking for. It scans this script's stdout, runs
 * `git push origin <tag>` for each — which is why the tag must already exist in this
 * checkout — and then cuts the Releases.
 *
 * Also self-heals: a version already on npm whose tag never reached origin gets its tag and
 * `New tag:` line restored, so no release stays permanently untagged.
 *
 * Run via `pnpm release`. Pass --dry-run to preview without publishing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dryRun = process.argv.includes("--dry-run");
const root = new URL("../", import.meta.url);

/** The publishable packages: the CLI at the repo root, plus each integration. */
function publishablePackages() {
  const dirs = [root];
  const integrations = new URL("integrations/", root);
  for (const entry of readdirSync(integrations, { withFileTypes: true })) {
    if (entry.isDirectory()) dirs.push(new URL(`${entry.name}/`, integrations));
  }
  const out = [];
  for (const dir of dirs) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(new URL("package.json", dir), "utf8"));
    } catch {
      continue; // no readable package.json here
    }
    if (pkg.private || !pkg.name || !pkg.version) continue;
    out.push({ name: pkg.name, version: pkg.version, dir: fileURLToPath(dir) });
  }
  return out;
}

/** Is this exact name@version already on the npm registry? */
function isPublished(name, version) {
  try {
    // --prefer-online revalidates npm's HTTP cache rather than trusting a stale packument,
    // so a version published moments ago is still seen.
    const raw = execFileSync("npm", ["view", name, "versions", "--json", "--prefer-online"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let versions = JSON.parse(raw);
    if (!Array.isArray(versions)) versions = [versions]; // single-version packages come back bare
    return versions.includes(version);
  } catch (err) {
    const stderr = String(err?.stderr ?? "");
    if (stderr.includes("E404") || stderr.includes("404")) return false; // genuinely not on npm
    // A network or auth hiccup is not evidence the version is unpublished — fail loudly
    // rather than trigger a bogus publish.
    throw err;
  }
}

/** Annotated tag at HEAD, like `changeset publish` makes; a pre-existing tag only warns. */
function ensureLocalTag(tag) {
  try {
    execFileSync("git", ["tag", tag, "-m", tag], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    console.error(`warning: could not create git tag ${tag}: ${String(err?.stderr ?? err)}`);
  }
}

/**
 * A version can be live on npm with no git tag and no Release — a previous run published,
 * then the action pushed nothing because it couldn't parse pnpm's output. Such a version
 * never re-enters `pending`, so without this pass its tag stays lost forever. Re-create it
 * at this run's commit (the original release commit isn't knowable) and re-print `New tag:`
 * so the action pushes it and cuts the Release. Never fails the run.
 */
function restoreMissingTags(onNpm) {
  if (onNpm.length === 0) return;
  let remote;
  try {
    const raw = execFileSync("git", ["ls-remote", "--tags", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    remote = new Set(
      raw
        .split("\n")
        .map((line) => line.split("\t")[1])
        .filter(Boolean)
        .map((ref) => ref.replace("refs/tags/", "").replace(/\^\{\}$/, "")),
    );
  } catch (err) {
    console.error(`warning: could not list origin tags, skipping restore: ${String(err?.stderr ?? err)}`);
    return;
  }
  for (const p of onNpm) {
    const tag = `${p.name}@${p.version}`;
    if (remote.has(tag)) continue;
    if (dryRun) {
      console.log(`(dry run) would restore missing tag ${tag}`);
      continue;
    }
    console.log(`Restoring missing tag for already-published ${tag}`);
    ensureLocalTag(tag);
    console.log(`New tag: ${tag}`);
  }
}

const pkgs = publishablePackages();
const label = (list) => list.map((p) => `${p.name}@${p.version}`).join(", ");
const pending = pkgs.filter((p) => !isPublished(p.name, p.version));

restoreMissingTags(pkgs.filter((p) => !pending.includes(p)));

if (pending.length === 0) {
  console.log(`Nothing to publish. Already on npm: ${label(pkgs)}`);
  process.exit(0);
}

console.log(`Publishing: ${label(pending)}`);
if (dryRun) {
  console.log("(dry run) skipping publish");
  process.exit(0);
}

const published = [];
const failed = [];
for (const p of pending) {
  try {
    // The same call `changeset publish` makes: from the package dir, --access public per
    // .changeset/config.json, and --no-git-checks so pnpm doesn't balk at CI's git state.
    // Provenance and OIDC trusted publishing come from the workflow env.
    execFileSync("pnpm", ["publish", "--access", "public", "--no-git-checks"], {
      cwd: p.dir,
      stdio: "inherit",
    });
    // changesets/action will `git push origin <tag>`, so the tag must exist locally.
    const tag = `${p.name}@${p.version}`;
    ensureLocalTag(tag);
    console.log(`New tag: ${tag}`);
    published.push(p);
  } catch {
    // A non-zero exit is benign only if the version is already on npm (our pre-check raced
    // a concurrent publish); anything else is a real failure.
    if (isPublished(p.name, p.version)) {
      console.error(`${p.name}@${p.version} is already on npm — skipping.`);
    } else {
      failed.push(p);
    }
  }
}

if (failed.length > 0) {
  console.error(`Failed to publish: ${label(failed)}`);
  process.exit(1);
}
console.log(`Published: ${label(published)}`);
