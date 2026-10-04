import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { planLines, progress, renderTui, summarize } from "../views/plan/tui.ts";
import type { PlanData } from "../views/plan/types.ts";

/**
 * update_plan: the agent shows its plan as a checklist and ticks steps off as it works.
 * - Terminal: a live widget above the editor, plus the checklist in the transcript.
 * - Web UI: the Plan section of the side card (from the tool result's details { view: "plan", data }).
 * - JSON/RPC: the same details, for any client.
 * The latest plan is rebuilt from the session when a chat is opened again.
 */

const WIDGET = "forge-plan";

const updatePlan = defineTool({
	name: "update_plan",
	label: "Plan",
	description:
		"Show the user your plan as a checklist and keep it current. For any task with more than two steps, call it before starting, " +
		"with every step (the first one in_progress, the rest pending). Call it again whenever a step finishes or the plan changes, " +
		"always sending the full list: mark finished steps done, the current step in_progress (at most one), and drop or mark skipped what you no longer need.",
	parameters: Type.Object({
		explanation: Type.Optional(Type.String({ description: "One short line: what the plan is for, or what changed." })),
		plan: Type.Array(
			Type.Object({
				step: Type.String({ description: "A concrete step, a few words, starting with a verb" }),
				status: StringEnum(["pending", "in_progress", "done", "skipped"] as const),
			}),
			{ minItems: 1, maxItems: 30 },
		),
	}),
	annotations: { readOnlyHint: true },
	executionMode: "sequential",
	async execute(_id, params) {
		const inProgress = params.plan.filter((s) => s.status === "in_progress").length;
		if (inProgress > 1) throw new Error(`Only one step can be in_progress; got ${inProgress}. Send the plan again.`);
		const data: PlanData = { explanation: params.explanation, steps: params.plan };
		const { done, total } = progress(data);
		const next = data.steps.find((s) => s.status === "in_progress") ?? data.steps.find((s) => s.status === "pending");
		const text = done === total ? `Plan complete: ${done}/${total} steps done.` : `Plan updated: ${done}/${total} done.${next ? ` Next: ${next.step}` : ""}`;
		return { content: [{ type: "text" as const, text }], details: { view: "plan", data } };
	},
	renderCall(args, theme) {
		const data: PlanData = { steps: args.plan ?? [] };
		const { done, total } = progress(data);
		return new Text(`${theme.fg("toolTitle", theme.bold("plan "))}${theme.fg("muted", `${done}/${total}`)}`, 0, 0);
	},
	renderResult(result, options, theme) {
		const data = (result.details as { data?: PlanData } | undefined)?.data;
		if (!data) return new Text(result.content[0]?.type === "text" ? result.content[0].text : "", 0, 0);
		return renderTui(data, theme, options.expanded);
	},
});

function showPlan(ctx: ExtensionContext, data: PlanData | undefined): void {
	if (!ctx.hasUI) return;
	if (!data || data.steps.length === 0) {
		ctx.ui.setWidget(WIDGET, undefined);
		return;
	}
	if (ctx.mode === "tui") {
		ctx.ui.setWidget(WIDGET, (_tui, theme) => ({
			render: (width: number) => planLines(data, theme, false).map((l) => truncateToWidth(l, width)),
			invalidate() {},
		}));
	} else {
		ctx.ui.setWidget(WIDGET, [`Plan: ${summarize(data)}`]);
	}
}

/** The newest plan on the active branch of the session, if any. */
function latestPlan(ctx: ExtensionContext): PlanData | undefined {
	let latest: PlanData | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "toolResult" || msg.toolName !== "update_plan" || msg.isError) continue;
		const data = (msg.details as { data?: PlanData } | undefined)?.data;
		if (data) latest = data;
	}
	return latest;
}

export function createPlan() {
	return function (pi: ExtensionAPI) {
		pi.registerTool(updatePlan);
		pi.on("session_start", async (_event, ctx) => showPlan(ctx, latestPlan(ctx)));
		pi.on("session_tree", async (_event, ctx) => showPlan(ctx, latestPlan(ctx)));
		pi.on("tool_execution_end", async (event, ctx) => {
			if (event.toolName !== "update_plan" || event.isError) return;
			showPlan(ctx, (event.result?.details as { data?: PlanData } | undefined)?.data);
		});
	};
}
