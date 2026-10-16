// Brings package.json's devEngines.runtime up to the newest Node LTS, held to
// pnpm-workspace.yaml's minimumReleaseAge like every other release. Run by
// `pnpm ncu:u`: npm-check-updates bumps devEngines.packageManager but not the
// runtime yet. `--check` only says what it would do.
import { readFileSync, writeFileSync } from "node:fs";

let minutes = 0;
try {
  const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
  minutes = Number(/^minimumReleaseAge:\s*(\d+)$/m.exec(workspace)?.[1] ?? 0);
} catch {}

const response = await fetch("https://nodejs.org/dist/index.json");
if (!response.ok) throw new Error(`${response.status} from nodejs.org`);
const releases = await response.json();
const newest = releases.find(
  (release) => release.lts && Date.now() - Date.parse(release.date) >= minutes * 60_000,
);
if (!newest) throw new Error("nodejs.org lists no LTS release old enough");

const text = readFileSync("package.json", "utf8");
const manifest = JSON.parse(text);
const current = manifest.devEngines.runtime.version;
const target = newest.version.slice(1);
const [a, b] = [target, current].map((version) => version.split(".").map(Number));

if ((a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) <= 0) {
  console.log(`Node ${current} is up to date`);
} else if (process.argv.includes("--check")) {
  console.log(`Node ${current} → ${target} (pnpm ncu:u)`);
} else {
  manifest.devEngines.runtime.version = target;
  const indent = /^(\s+)"/m.exec(text)?.[1] ?? 2;
  writeFileSync("package.json", `${JSON.stringify(manifest, null, indent)}\n`);
  console.log(`Node ${current} → ${target}`);
}
