# Changesets

Every user-visible change gets a changeset: run `pnpm changeset`, pick the bump,
and write the note in the reader's terms — what changed for someone using
runcommand, not what moved in the source.

Two project-specific rules:

- **A changed generated config block is at least a `minor`, and its note must say
  "re-run `runcommand init`".** Upgrading the package never rewrites the lines
  already sitting in someone's `starship.toml`; only `init` does. See `BLOCK_V` in
  `bin/runcommand.mjs`, and the Versioning section of `CONTRIBUTING.md`.
- **Detection-cache shape changes (`CACHE_V`) don't need a note.** A version the
  build doesn't recognise is treated as a cache miss and re-detected silently.

Two packages are released from here: `@amabush/runcommand` (the CLI, `bin/`) and
`@amabush/runcommand-opencode` (the TUI plugin, `integrations/opencode/`). They version
independently — a plugin fix shouldn't bump the CLI. `site/` is not a workspace
member and is never released.

Full docs: https://github.com/changesets/changesets
