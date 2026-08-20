// Guard: a generated config block must never change without BLOCK_V changing too.
//
// This is the failure a package release cannot fix. `npm i -g @amabush/runcommand@latest`
// updates the binary; it never touches the lines already written into someone's
// ~/.config/starship.toml. Only `runcommand init` rewrites those, and it only
// offers to when the block's marker records an older BLOCK_V. So editing a block
// while leaving BLOCK_V alone strands every existing install on the old config,
// silently and permanently.
//
// IF THIS TEST FAILS you changed a generated block. To resolve it:
//   1. bump BLOCK_V in bin/runcommand.mjs,
//   2. add an entry below for the new version (keep the old ones — they document
//      what each version actually contained), covering both platform variants,
//   3. `pnpm changeset` — minor or higher, and say "re-run `runcommand init`" in
//      the note, since that's the only thing that delivers the fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockFingerprints, BLOCK_V } from "../bin/runcommand.mjs";

// Invocation is stubbed as "<self>", and the platform is passed to block() rather
// than read from process.platform, so these are identical on every runner. Both
// variants are pinned because the starship block genuinely differs — Windows has no
// bash to pin — and the Windows one is the variant no local machine can produce.
const FINGERPRINTS = {
  2: {
    starship: {
      posix: "c739558482bbd9fb03201308e01268407f06899e",
      win32: "56c12111e49c085ba3cd1ba546c2487dfe6882d3",
    },
    tmux: {
      posix: "175bbf9f139946b21be245ad58bb00d247d747a7",
      win32: "175bbf9f139946b21be245ad58bb00d247d747a7",
    },
  },
};

test("every generated block is pinned to the current BLOCK_V", () => {
  assert.ok(
    FINGERPRINTS[BLOCK_V],
    `BLOCK_V is ${BLOCK_V} but no fingerprints are recorded for it — add an entry (see the header of this file)`,
  );
  assert.deepEqual(blockFingerprints(), FINGERPRINTS[BLOCK_V]);
});

test("fingerprints cover every block harness", () => {
  // A new surface added to BLOCK_HARNESSES has to be pinned too, or it could drift
  // unnoticed while the existing two stay green.
  assert.deepEqual(Object.keys(blockFingerprints()).sort(), Object.keys(FINGERPRINTS[BLOCK_V]).sort());
});
