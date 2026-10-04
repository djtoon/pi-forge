// Copied by forge from templates/views/plan/tui.ts. Do not edit here: edit the template and regenerate.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import type { PlanData, PlanStep } from "./types.ts";

const MARK: Record<PlanStep["status"], string> = { done: "✓", in_progress: "◐", pending: "○", skipped: "–" };

export function progress(data: PlanData): { done: number; total: number } {
	const total = data.steps.filter((s) => s.status !== "skipped").length;
	return { done: data.steps.filter((s) => s.status === "done").length, total };
}

/** Terminal checklist: header with progress, one line per step. Collapsed hides finished steps beyond the last two. */
export function planLines(data: PlanData, theme: Theme, expanded: boolean): string[] {
	const { done, total } = progress(data);
	const out = [`${theme.bold("Plan")} ${theme.fg("muted", `${done}/${total}`)}${data.explanation ? theme.fg("dim", `  ${data.explanation}`) : ""}`];
	let steps = data.steps;
	if (!expanded) {
		const firstOpen = steps.findIndex((s) => s.status !== "done");
		const from = firstOpen < 0 ? Math.max(0, steps.length - 2) : Math.max(0, firstOpen - 2);
		if (from > 0) out.push(theme.fg("dim", `  … ${from} done`));
		steps = steps.slice(from);
	}
	for (const s of steps) {
		const mark = MARK[s.status];
		if (s.status === "done") out.push(`  ${theme.fg("success", mark)} ${theme.fg("muted", s.step)}`);
		else if (s.status === "in_progress") out.push(`  ${theme.fg("accent", mark)} ${theme.bold(s.step)}`);
		else if (s.status === "skipped") out.push(`  ${theme.fg("dim", `${mark} ${s.step} (skipped)`)}`);
		else out.push(`  ${theme.fg("dim", mark)} ${s.step}`);
	}
	return out;
}

export function renderTui(data: PlanData, theme: Theme, expanded: boolean): Component {
	return {
		render: (width: number) => planLines(data, theme, expanded).map((l) => truncateToWidth(l, width)),
		invalidate() {},
	};
}

export function summarize(data: PlanData): string {
	const { done, total } = progress(data);
	const current = data.steps.find((s) => s.status === "in_progress");
	return `${done}/${total} done${current ? ` · now: ${current.step}` : ""}`;
}
