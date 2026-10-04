// Copied by forge from templates/ui/header.ts. Do not edit here: edit the template and regenerate.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export interface HeaderConfig {
	name: string;
	title: string;
	description?: string;
	hint?: string;
	/** Lines of ASCII art, drawn in the accent color. */
	art: string[];
}

/** Harness header (terminal) and window title (terminal and RPC clients). */
export function createHeader(config: HeaderConfig) {
	return function (pi: ExtensionAPI) {
		pi.on("session_start", async (_event, ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.setTitle(config.title);
			if (ctx.mode !== "tui") return;
			ctx.ui.setHeader((_tui, theme) => ({
				render(width: number): string[] {
					const lines = [
						"",
						...config.art.map((l) => theme.fg("accent", l)),
						`  ${theme.bold(theme.fg("accent", config.title))}${theme.fg("dim", `  · ${config.name} · built with pi-Forge`)}`,
					];
					if (config.description) lines.push(`  ${theme.fg("muted", config.description)}`);
					if (config.hint) lines.push(`  ${theme.fg("dim", config.hint)}`);
					lines.push("");
					return lines.map((l) => truncateToWidth(l, width));
				},
				invalidate() {},
			}));
		});
	};
}
