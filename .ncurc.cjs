// npm-check-updates config, read by `pnpm dlx npm-check-updates`.
// A .cjs config because this repo is "type": "module", so a .js one would load as ESM.
module.exports = {
  // Never propose a version published less than 7 days ago. Compromised releases are typically
  // yanked within hours-to-days, so a week's lag lets the ecosystem find the bad ones first, at the
  // cost of adopting genuine fixes a week late. With target `latest`, a package whose newest release
  // falls inside the window drops back to the newest release OLDER than the window rather than being
  // skipped, so updates keep flowing. Only governs what ncu PROPOSES for direct deps — it is not an
  // install-time gate (pnpm's own `minimumReleaseAge` in pnpm-workspace.yaml is that, and covers
  // transitive deps too).
  cooldown: 7,

  target: "latest",
};
