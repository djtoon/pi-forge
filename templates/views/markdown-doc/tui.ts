import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { MarkdownDocData } from "./types.ts";

const COLLAPSED_LINES = 10;

/** Terminal fallback: the markdown source, headings highlighted, capped unless expanded. */
export function docLines(data: MarkdownDocData, theme: Theme, expanded: boolean): string[] {
	const src = data.markdown.split("\n");
	const shown = expanded ? src : src.slice(0, COLLAPSED_LINES);
	const out = shown.map((line) => (/^#{1,6} /.test(line) ? theme.bold(theme.fg("accent", line)) : line));
	if (shown.length < src.length) out.push(theme.fg("dim", `… ${src.length - shown.length} more lines (expand, or open the web UI)`));
	return out;
}

export function renderTui(data: MarkdownDocData, theme: Theme, expanded: boolean): Component {
	return {
		render: (width: number) => docLines(data, theme, expanded).flatMap((l) => wrapTextWithAnsi(l, width)),
		invalidate() {},
	};
}

export function summarize(data: MarkdownDocData): string {
	const heading = data.markdown.split("\n").find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "");
	return `${data.title ?? heading ?? "document"} (${data.markdown.length} chars)`;
}
