// Copied by forge from templates/views/data-table/tui.ts. Do not edit here: edit the template and regenerate.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DataTableData } from "./types.ts";

const MAX_COL = 28;
const COLLAPSED_ROWS = 6;

function cell(value: string | number | null): string {
	if (value === null) return "–";
	return typeof value === "number" ? String(Number(value.toFixed(3))) : value;
}

/** Terminal fallback for the data-table view: aligned columns, rows capped unless expanded. */
export function tableLines(data: DataTableData, theme: Theme, expanded: boolean): string[] {
	const rows = data.rows.map((row) => row.map(cell));
	const widths = data.columns.map((col, i) =>
		Math.min(MAX_COL, Math.max(visibleWidth(col), ...rows.map((r) => visibleWidth(r[i] ?? "")))),
	);
	const line = (values: string[]) =>
		values.map((v, i) => truncateToWidth(v, widths[i] ?? MAX_COL).padEnd(widths[i] ?? 0)).join("  ");

	const out: string[] = [];
	if (data.title) out.push(theme.bold(data.title));
	out.push(theme.fg("accent", line(data.columns)));
	out.push(theme.fg("dim", widths.map((w) => "─".repeat(w)).join("  ")));
	const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);
	for (const row of shown) out.push(line(row));
	if (shown.length < rows.length) out.push(theme.fg("dim", `… ${rows.length - shown.length} more rows (expand to see all)`));
	return out;
}

export function renderTui(data: DataTableData, theme: Theme, expanded: boolean): Component {
	return {
		render: (width: number) => tableLines(data, theme, expanded).map((l) => truncateToWidth(l, width)),
		invalidate() {},
	};
}

/** One line, for panels in non-terminal clients and logs. */
export function summarize(data: DataTableData): string {
	return `${data.title ?? "table"}: ${data.rows.length} rows × ${data.columns.length} columns`;
}
