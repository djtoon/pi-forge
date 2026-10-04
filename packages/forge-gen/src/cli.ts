#!/usr/bin/env node
import { resolve } from "node:path";
import { applyPlan, formatPlan, planHarness } from "./index.ts";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
	console.error("usage: forge-gen <harness-dir> [--apply] [--force] [--diff]");
	process.exit(2);
}

const plan = planHarness(resolve(dir));
console.log(formatPlan(plan));
if (plan.issues.some((i) => i.severity === "error")) process.exit(1);

if (args.includes("--diff")) {
	for (const c of plan.changes) if (c.patch) console.log(c.patch);
}
if (args.includes("--apply")) {
	try {
		const result = applyPlan(plan, { force: args.includes("--force") });
		console.log(`applied: ${result.written.length} written, ${result.deleted.length} deleted`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
} else if (plan.changes.some((c) => c.kind !== "unchanged")) {
	console.log("dry run: pass --apply to write");
}
