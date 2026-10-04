// Copied by forge from templates/views/chart/tui.ts. Do not edit here: edit the template and regenerate.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { ChartData } from "./types.ts";

const BAR = "█";
const SPARK = "▁▂▃▄▅▆▇█";

function num(v: number | null | undefined): string {
	return v === null || v === undefined ? "–" : String(Number(v.toFixed(2)));
}

/** Terminal fallback: horizontal bars (bar) or sparklines (line). Collapsed shows the first series. */
export function chartLines(data: ChartData, theme: Theme, expanded: boolean, width = 80): string[] {
	const out: string[] = [];
	if (data.title) out.push(theme.bold(data.title));
	const series = expanded ? data.series : data.series.slice(0, 1);
	const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
	const max = Math.max(1e-9, ...all.map(Math.abs));
	const unit = data.unit ? ` ${data.unit}` : "";

	if (data.kind === "line") {
		const min = Math.min(...all);
		for (const s of series) {
			const spark = s.values
				.map((v) => (v === null ? " " : SPARK[Math.round(((v - min) / (max - min || 1)) * (SPARK.length - 1))]))
				.join("");
			const last = s.values.at(-1);
			out.push(`${theme.fg("muted", s.name.padEnd(10))} ${theme.fg("accent", spark)}  ${num(last)}${unit}`);
		}
		out.push(theme.fg("dim", `${" ".repeat(11)}${data.labels[0] ?? ""} … ${data.labels.at(-1) ?? ""}`));
		return out;
	}

	const labelWidth = Math.min(16, Math.max(...data.labels.map((l) => l.length)));
	const barWidth = Math.max(8, Math.min(40, width - labelWidth - 20));
	for (const s of series) {
		if (series.length > 1) out.push(theme.fg("muted", s.name));
		data.labels.forEach((label, i) => {
			const v = s.values[i];
			const len = v === null || v === undefined ? 0 : Math.max(1, Math.round((Math.abs(v) / max) * barWidth));
			out.push(`${label.slice(0, labelWidth).padEnd(labelWidth)} ${theme.fg("accent", BAR.repeat(len))} ${num(v)}${unit}`);
		});
	}
	if (!expanded && data.series.length > 1) out.push(theme.fg("dim", `+${data.series.length - 1} more series (expand)`));
	return out;
}

export function renderTui(data: ChartData, theme: Theme, expanded: boolean): Component {
	return {
		render: (width: number) => chartLines(data, theme, expanded, width).map((l) => truncateToWidth(l, width)),
		invalidate() {},
	};
}

export function summarize(data: ChartData): string {
	return `${data.title ?? "chart"}: ${data.series.length} series × ${data.labels.length} points`;
}
