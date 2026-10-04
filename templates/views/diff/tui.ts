import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { DiffData } from "./types.ts";

const COLLAPSED_LINES = 12;

function stats(patch: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return { added, removed };
}

/** Terminal fallback: per-file stats, then colored hunks (capped unless expanded). */
export function diffLines(data: DiffData, theme: Theme, expanded: boolean): string[] {
	const out: string[] = [];
	if (data.title) out.push(theme.bold(data.title));
	for (const file of data.files) {
		const s = stats(file.patch);
		out.push(`${theme.fg("accent", file.path)}  ${theme.fg("success", `+${s.added}`)} ${theme.fg("error", `-${s.removed}`)}`);
		const body = file.patch.split("\n").filter((l) => !l.startsWith("---") && !l.startsWith("+++") && l !== "");
		const shown = expanded ? body : body.slice(0, COLLAPSED_LINES);
		for (const line of shown) {
			if (line.startsWith("+")) out.push(theme.fg("success", line));
			else if (line.startsWith("-")) out.push(theme.fg("error", line));
			else if (line.startsWith("@@")) out.push(theme.fg("dim", line));
			else out.push(line);
		}
		if (shown.length < body.length) out.push(theme.fg("dim", `… ${body.length - shown.length} more lines (expand)`));
	}
	return out;
}

export function renderTui(data: DiffData, theme: Theme, expanded: boolean): Component {
	return {
		render: (width: number) => diffLines(data, theme, expanded).map((l) => truncateToWidth(l, width)),
		invalidate() {},
	};
}

export function summarize(data: DiffData): string {
	const total = data.files.map((f) => stats(f.patch)).reduce((a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed }), { added: 0, removed: 0 });
	return `${data.files.length} file(s), +${total.added} -${total.removed}`;
}
