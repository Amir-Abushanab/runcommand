---
"@amabush/runcommand": patch
---

`init` warns when runcommand is installed inside one Node version's directory

Under a Node version manager (nvm, fnm, mise, asdf), `npm i -g` installs into the
current Node version's own directory, and PATH only points there until the next Node
upgrade. After that, `runcommand` stops resolving and every status line wired to it
renders blank, with no error anywhere. That includes a status line it wraps through
`RUNCOMMAND_BASE`. `init` now says so when it finds a copy like that, and prints the
fix: `pnpm add -g @amabush/runcommand && npm rm -g @amabush/runcommand`.

The README and the npx refusal now lead with `pnpm add -g`, since pnpm keeps globals
outside the version directories. So does bun, and npm is still fine for a Node that
doesn't come from a version manager.
