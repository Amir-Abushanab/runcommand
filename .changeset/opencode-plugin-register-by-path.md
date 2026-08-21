---
"@amabush/runcommand-opencode": patch
---

Document the registration form that actually works: a **path** to `dist/tui.js`, not the
package name.

`"plugin": ["@amabush/runcommand-opencode/tui"]` looks right and resolves fine from
`~/.config/opencode` — but OpenCode resolves plugin specifiers from the project it is
running in, where an installed package under the config directory is not on the resolution
path. It is never found, and nothing says so: no error, no plugin, an empty footer.

Install as before, then point `tui.json` at the file:

```json
{ "plugin": ["/Users/you/.config/opencode/node_modules/@amabush/runcommand-opencode/dist/tui.js"] }
```
