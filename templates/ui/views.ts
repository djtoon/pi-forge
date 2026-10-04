import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { isViewDetails } from "../views/contract.ts";

/** What each view's tui.ts exports. */
export interface TuiViewModule {
	renderTui(data: never, theme: Theme, expanded: boolean): Component;
	summarize(data: never): string;
}

export interface ViewRegistryConfig {
	/** view id → its tui.ts module */
	modules: Record<string, TuiViewModule>;
	/** view id → title shown above the pinned panel */
	panelTitles: Record<string, string>;
	views: { id: string; shows: string[]; panel?: "right" | "left" | "bottom" }[];
}

interface ResultLike {
	content: { type: string; text?: string }[];
	details?: unknown;
}

/**
 * The harness's views in the terminal:
 * - `withViews(tool)` gives a tool a renderResult that draws `details.view` with the matching view,
 *   so custom tools only return data (`viewResult(...)`) and never contain UI code;
 * - `extension` pins the latest result of panel views as a widget (TUI) or one-line widget (RPC).
 */
export function createViewRegistry(config: ViewRegistryConfig) {
	function renderResult(result: ResultLike, options: { expanded: boolean }, theme: Theme): Component {
		const details = result.details;
		if (isViewDetails(details)) {
			const mod = config.modules[details.view];
			if (mod) return mod.renderTui(details.data as never, theme, options.expanded);
		}
		const text = result.content.find((c) => c.type === "text")?.text ?? "";
		return new Text(text, 0, 0);
	}

	function withViews<T extends object>(tool: T): T {
		if ("renderResult" in tool && tool.renderResult) return tool;
		return { ...tool, renderResult };
	}

	const panels = new Set(config.views.filter((v) => v.panel).map((v) => v.id));

	function extension(pi: ExtensionAPI): void {
		if (panels.size === 0) return;
		pi.on("tool_execution_end", async (event, ctx) => {
			const details = event.result?.details;
			if (event.isError || !ctx.hasUI || !isViewDetails(details) || !panels.has(details.view)) return;
			const mod = config.modules[details.view];
			if (!mod) return;
			const key = `forge-panel-${details.view}`;
			const title = config.panelTitles[details.view] ?? details.view;
			if (ctx.mode === "tui") {
				ctx.ui.setWidget(key, (_tui, theme) => {
					const body = mod.renderTui(details.data as never, theme, false);
					return {
						render: (width: number) =>
							[theme.fg("dim", title), ...body.render(width)].map((l) => truncateToWidth(l, width)),
						invalidate: () => body.invalidate(),
					};
				});
			} else {
				ctx.ui.setWidget(key, [`${title}: ${mod.summarize(details.data as never)}`]);
			}
		});
	}

	return { renderResult, withViews, extension, ids: Object.keys(config.modules) };
}
