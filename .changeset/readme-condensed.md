---
"runcommand": patch
---

Condense the README and move the maintainer docs out of it.

It had grown long enough that the parts people actually need — install, wiring,
overrides — were buried under reference material. It's about a third shorter now,
with nothing dropped that a user needs:

- **Versioning and compatibility** and **Releasing** moved to `CONTRIBUTING.md` —
  they're rules for changing the formats, not for using the tool. The README keeps
  the one line that matters to a user: re-run `runcommand init` after upgrading.
- **How detection works** removed; it restated the detection and cache sections.
- Shell prompt, other agents, and ambient surfaces merged into one **Other
  surfaces** section (so `init`'s pointers to the old section names were updated).
- The Zellij layout and the Windows platform table are now collapsed `<details>` —
  still there, just not in the way.
