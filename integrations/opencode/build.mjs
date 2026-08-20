/**
 * Build the plugin bundle.
 *
 * Two rules, each learned by getting it wrong and staring at an empty footer:
 *
 * 1. `solidPlugin` is what makes the plugin reactive at all. Solid's reactivity is a
 *    COMPILE-TIME transform: it rewrites `when={shown()}` into `get when() { … }` so
 *    the prop is re-read when the signal changes. Bun's built-in JSX transform
 *    evaluates props eagerly, which yields a view frozen at its startup values —
 *    reactive signals feeding non-reactive JSX. `@opentui/solid` ships this transform
 *    as a bun plugin, and `bun build` can only take plugins through the JS API, which
 *    is the whole reason this file exists instead of a CLI one-liner.
 *
 * 2. Everything the host owns stays EXTERNAL — solid-js, @opentui/solid, @opentui/core.
 *    Bundling a copy of Solid gives the plugin its own reactive graph and its own
 *    renderer, so the elements it builds are not the ones OpenCode knows how to paint:
 *    it loads, registers, renders, and nothing appears. Sharing the host's instances is
 *    what makes the slot actually mount. It also keeps the bundle ~7 KB instead of
 *    ~106 KB, since this file is then only the plugin's own logic.
 *
 * (An earlier version pinned `conditions: ["browser"]` to dodge solid-js's server
 * build. With solid-js external that has no effect on the output — the host resolves
 * it — but it is kept as a guard in case anything Solid-adjacent is ever inlined.)
 */
import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  conditions: ["browser"],
  external: ["solid-js", "@opentui/solid", "@opentui/core", "@opencode-ai/plugin"],
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`built ${result.outputs.map((o) => `${o.path} (${(o.size / 1024).toFixed(1)} KB)`).join(", ")}`);
