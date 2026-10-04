import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Guardrails from the `guards:` section of harness.yaml:
 *   protectedPaths: globs that write/edit may not touch
 *   confirmBash:    substrings that make a bash/powershell command need confirmation
 * With a UI the user is asked; without one (print/json mode) the call is blocked.
 */
export interface GuardsConfig {
	protectedPaths: string[];
	confirmBash: string[];
}

function globToRegExp(glob: string): RegExp {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i] as string;
		if (c === "*" && glob[i + 1] === "*") {
			const slash = glob[i + 2] === "/";
			re += slash ? "(?:.*/)?" : ".*";
			i += slash ? 2 : 1;
		} else if (c === "*") re += "[^/]*";
		else if (c === "?") re += "[^/]";
		else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	// A pattern without a slash matches the file name anywhere, like .gitignore.
	return new RegExp(glob.includes("/") ? `^${re}$` : `(?:^|/)${re}$`);
}

export function createGuards(config: GuardsConfig) {
	const pathRules = config.protectedPaths.map((glob) => ({ glob, re: globToRegExp(glob) }));

	return function (pi: ExtensionAPI) {
		if (pathRules.length === 0 && config.confirmBash.length === 0) return;

		pi.on("tool_call", async (event, ctx) => {
			let reason: string | undefined;
			const input = event.input as { path?: unknown; command?: unknown };

			if ((event.toolName === "write" || event.toolName === "edit") && typeof input.path === "string") {
				const path = input.path.replace(/\\/g, "/");
				const hit = pathRules.find((r) => r.re.test(path));
				if (hit) reason = `${event.toolName} ${input.path} matches protected path "${hit.glob}"`;
			} else if ((event.toolName === "bash" || event.toolName === "powershell") && typeof input.command === "string") {
				const command = input.command;
				const hit = config.confirmBash.find((s) => command.includes(s));
				if (hit) reason = `${event.toolName} command contains "${hit}"`;
			}
			if (!reason) return;

			if (ctx.hasUI && (await ctx.ui.confirm("Guarded action", `${reason}. Allow it?`))) return;
			return { block: true, reason: `Blocked by harness guard: ${reason}` };
		});
	};
}
