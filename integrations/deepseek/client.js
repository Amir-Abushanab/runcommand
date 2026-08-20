// runcommand — DeepSeek Harness plugin, CLIENT plane (browser).
//
// Hand-written in dsh's client-bundle shape rather than emitted by their build:
// `window.__ModuleLoader__.load({ id, factory })`, where the factory is plain CJS
// and only runs at materialization. `id` is the package name — dsh resolves the
// bare id and `<id>/client` to the same exports.
//
// It seats one row in `conversation.composer.dock`: the band under the composer
// card, which dsh's own slot contract calls "the seat for an ambient readout
// about the conversation" — the shipped stats line lives there too. That makes it
// the counterpart to Claude Code's status line and OpenCode's TUI footer.
window.__ModuleLoader__.load({
	id: "runcommand-dsh",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		/** Where the host row publishes; same origin as the app. */
		const ROUTE = "/runcommand";
		/** How often the row re-reads. A spawn behind runcommand's disk cache — cheap. */
		const REFRESH_MS = 5000;
		/** Per-service colours, cycled; a single command keeps the first. */
		const PALETTE = ["#22d3ee", "#a78bfa", "#4ade80", "#60a5fa"];

		const dim = (key, text, extra) =>
			react.createElement("span", { key, style: Object.assign({ opacity: 0.55 }, extra || {}) }, text);

		/** The row. A pure function of its own polled state. */
		function RunCommandLine() {
			const [data, setData] = react.useState(null);
			react.useEffect(() => {
				let live = true;
				const tick = () => {
					fetch(ROUTE, { headers: { accept: "application/json" } })
						.then((r) => (r.ok ? r.json() : null))
						.then((next) => { if (live) setData(next); })
						.catch(() => { if (live) setData(null); });
				};
				tick();
				const id = setInterval(tick, REFRESH_MS);
				return () => { live = false; clearInterval(id); };
			}, []);

			if (data === null) return null;
			const commands = Array.isArray(data.commands) ? data.commands : [];
			const ports = Array.isArray(data.ports) ? data.ports : [];
			// Empty stays empty: an unrelated workspace should cost no vertical space.
			if (!data.detecting && commands.length === 0 && ports.length === 0) return null;

			const parts = [dim("icon", "▶")];
			if (data.detecting && commands.length === 0) parts.push(dim("detecting", "finding run command…"));
			commands.forEach((entry, index) => {
				if (index > 0) parts.push(dim(`sep${index}`, "·", { opacity: 0.4 }));
				if (entry.label) parts.push(dim(`label${index}`, `${entry.label}:`));
				parts.push(react.createElement(
					"span",
					{ key: `cmd${index}`, style: { color: PALETTE[index % PALETTE.length] } },
					entry.command,
				));
			});
			if (ports.length > 0) {
				parts.push(dim("ports", "◉", { marginInlineStart: "0.35em" }));
				ports.forEach((port) => parts.push(react.createElement(
					"a",
					{
						key: `port${port}`,
						href: `http://localhost:${port}`,
						target: "_blank",
						rel: "noopener",
						style: { color: PALETTE[0], textDecoration: "none" },
					},
					`:${port}`,
				)));
			}

			return react.createElement(
				"div",
				{
					style: {
						display: "flex", alignItems: "center", gap: "0.45em", minWidth: 0,
						padding: "0.15em 0.1em",
						font: "0.75rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
						whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
					},
				},
				parts,
			);
		}

		/** Required service: the UI slot registry. */
		const inject = ["slots"];

		/** Seat the row. `slots.inject` waits for the slot's declaration. */
		function apply(ctx) {
			// A `list` slot requires an id — several rows share the band, and the id is
			// how this one is identified among them.
			ctx.slots.inject("conversation.composer.dock", () =>
				ctx.slots.register({ name: "conversation.composer.dock", id: "runcommand" }, RunCommandLine));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
