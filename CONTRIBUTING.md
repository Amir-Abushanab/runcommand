# Contributing

runcommand is a single dependency-free Node file (`bin/runcommand.mjs`, built-ins only) plus
tests. `pnpm test` runs the suite with `node --test`; CI runs it on Linux, macOS **and**
Windows, plus a CLI smoke test on each — that matrix is the only place the Windows code
actually executes.

## Versioning and compatibility

runcommand persists three quite different kinds of state, and each gets a different
compatibility rule. Worth knowing before you change one of these formats.

**1. The detection cache — versioned, and disposable.** Every cache file carries a `"v"`
field. A file whose `v` this build doesn't recognise is treated as a plain cache miss,
exactly like a signals-hash mismatch, and re-detected. That's safe in both directions: an
old build ignores a field it's never heard of, and a new build refuses to read a shape it
doesn't understand. It's cheap to be strict here — the cache is derived state, so the
entire cost of discarding one is a single detection call. The separate ports cache is
deliberately *not* versioned; it self-heals inside its 2.5 s TTL.

**2. The generated config blocks — versioned, and migrated.** This is the one that actually
needs care, because **`npm i -g runcommand@latest` cannot fix it**. `init` writes real lines
into files the user owns — `~/.config/starship.toml`, `~/.tmux.conf` — and a package upgrade
never revisits them. So each block is fenced with a version-stamped marker:

```toml
# >>> runcommand v2 (managed by `runcommand init`)
...
# <<< runcommand
```

Re-running `runcommand init` after an upgrade compares that stamp against the current
`BLOCK_V`. An older block is reported and **offered an in-place refresh** — only the lines
between the markers are touched, spacing around them is preserved, and the file is backed
up first, like every other write `init` makes. Older, unversioned markers
(`# >>> runcommand`, written before this existed) are still recognised as v1, so nothing
installed by an earlier release is stranded. A config wired up **by hand** has no markers,
and `init` will never rewrite it — it prints the one-line change to make and leaves the file
byte-for-byte alone.

**3. `.claude-run` and `CLAUDE.md` overrides — never versioned.** These are input the user
wrote, not state runcommand generated. The rule is simply that the syntax only ever grows:
new forms get added, existing ones keep working. Asking someone to migrate a file they
authored would be the wrong trade.

A related note on the cache shape: `normalizeCommands` still reads the original
single-`command` form as well as today's `commands` array, which is why multi-command
support was added as a new field rather than a rename. Both are covered by tests.

## Releasing

Releases go through [changesets](https://github.com/changesets/changesets): every
user-visible change gets a `pnpm changeset` note, `pnpm version` consumes them into a
version bump and `CHANGELOG.md`, and `pnpm release` publishes.

The rule that matters is the one changesets can't enforce on its own — **the npm version and
`BLOCK_V` are independent, and only `BLOCK_V` affects config people already have on disk.**
So a release that changes a generated block is a `minor` at minimum, and its note must say
*re-run `runcommand init`*. A test (`test/block-version.test.mjs`) fingerprints every
generated block and pins it to the current `BLOCK_V`, so changing one without bumping the
version fails the build rather than silently stranding existing installs.
