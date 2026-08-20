---
"@amabush/runcommand": patch
---

Releases now run from CI. A changeset landing on `main` opens a "chore: version
packages" PR; merging it publishes to npm, tags, and cuts the GitHub Release — no
commands typed, no npm token stored. Publishing authenticates over OIDC (npm Trusted
Publishing), so releases carry provenance attestations.
