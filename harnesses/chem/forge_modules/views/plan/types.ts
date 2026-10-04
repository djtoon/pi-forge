// Copied by forge from templates/views/plan/types.ts. Do not edit here: edit the template and regenerate.
/** Data for the `plan` view and the update_plan tool. */
export type PlanStatus = "pending" | "in_progress" | "done" | "skipped";

export interface PlanStep {
	step: string;
	status: PlanStatus;
}

export interface PlanData {
	/** Optional one-line note about the plan or what changed. */
	explanation?: string;
	steps: PlanStep[];
}
