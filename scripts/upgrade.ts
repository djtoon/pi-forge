#!/usr/bin/env node
/**
 * Keeps every harness current:   npm run upgrade -- [--pi <version>] [--apply] [--live]
 *
 *   --pi <version>  install that pi version (pinned) and set pi_version in every harness.yaml
 *   --apply         write changes (default: dry run, shows what would change)
 *   --live          also run one real prompt per harness (costs model tokens)
 *   --check         fail if any generated file is out of date (for CI; implies a dry run)
 *
 * Steps: (1) pi version, (2) regenerate every harness from its spec and the current templates,
 * (3) type-check the repo, (4) smoke-test every harness (free load check; live prompt with --live).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { applyPlan, formatPlan, installedPiVersion, liveCheck, loadCheck, planHarness, REPO_ROOT } from "@forge/gen";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const live = args.includes("--live");
const check = args.includes("--check") && !apply;
const piIndex = args.indexOf("--pi");
const targetPi = piIndex >= 0 ? args[piIndex + 1] : undefined;
const failures: string[] = [];

function sh(command: string): { ok: boolean; out: string } {
	const r = spawnSync(command, { cwd: REPO_ROOT, shell: true, encoding: "utf8" });
	return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function harnessDirs(): string[] {
	const root = join(REPO_ROOT, "harnesses");
	const dirs = existsSync(root) ? readdirSync(root).map((d) => join(root, d)).filter((d) => existsSync(join(d, "harness.yaml"))) : [];
	return [join(REPO_ROOT, "forge"), ...dirs];
}

const rel = (p: string) => relative(REPO_ROOT, p).replace(/\\/g, "/") || ".";
const heading = (s: string) => console.log(`\n== ${s}`);

// 1. pi version -------------------------------------------------------------------
heading("pi version");
const current = installedPiVersion();
console.log(`installed: ${current}${targetPi ? `, target: ${targetPi}` : ""}`);
if (targetPi && targetPi !== current) {
	if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(targetPi)) {
		console.error(`--pi needs an exact version like 1.0.1, got "${targetPi}"`);
		process.exit(2);
	}
	if (!apply) console.log(`would install @earendil-works/pi-coding-agent@${targetPi} and pi-tui@${targetPi}, and set pi_version in every harness.yaml`);
	else {
		for (const [pkg, ws] of [
			["@earendil-works/pi-coding-agent", "@forge/harness-core"],
			["@earendil-works/pi-tui", "@forge/harness-web"],
		]) {
			const r = sh(`npm install -E --ignore-scripts ${pkg}@${targetPi} -w ${ws}`);
			console.log(`${r.ok ? "installed" : "FAILED"} ${pkg}@${targetPi}`);
			if (!r.ok) {
				console.error(r.out.slice(-2000));
				process.exit(1);
			}
		}
		for (const dir of harnessDirs()) {
			const file = join(dir, "harness.yaml");
			const text = readFileSync(file, "utf8");
			writeFileSync(file, text.replace(/^pi_version:.*$/m, `pi_version: ${targetPi}`));
		}
		console.log(`set pi_version: ${targetPi} in ${harnessDirs().length} harness.yaml file(s)`);
		console.log("tip: check out the matching tag in vendor/pi-mono so the reference docs match");
	}
}

// 2. regenerate -------------------------------------------------------------------
heading(`regenerate${apply ? "" : " (dry run)"}`);
for (const dir of harnessDirs()) {
	const plan = planHarness(dir);
	console.log(formatPlan(plan));
	if (plan.issues.some((i) => i.severity === "error")) {
		failures.push(`${rel(dir)}: invalid harness.yaml`);
		continue;
	}
	if (check && plan.changes.some((c) => c.kind !== "unchanged")) {
		failures.push(`${rel(dir)}: generated files are out of date (run npm run upgrade -- --apply and commit)`);
	}
	if (!apply) continue;
	try {
		const result = applyPlan(plan);
		if (result.written.length + result.deleted.length > 0) console.log(`  applied: ${result.written.length} written, ${result.deleted.length} deleted`);
	} catch (error) {
		failures.push(`${rel(dir)}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
		console.log(`  skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
}

// 3. type-check -------------------------------------------------------------------
heading("type-check");
const tsc = sh("npx tsc -p .");
console.log(tsc.ok ? "ok" : tsc.out.slice(0, 4000));
if (!tsc.ok) failures.push("type-check failed");

// 4. smoke tests ------------------------------------------------------------------
heading(`smoke tests${live ? " (load + live)" : " (load)"}`);
for (const dir of harnessDirs()) {
	const load = await loadCheck(dir);
	console.log(`${load.ok ? "ok  " : "FAIL"} load  ${rel(dir)}  ${load.ms} ms  ${load.ok ? `model ${load.model}` : (load.error ?? "")}`);
	for (const line of load.stderr) console.log(`       ${line}`);
	if (!load.ok) {
		failures.push(`${rel(dir)}: load check failed`);
		continue;
	}
	if (!live) continue;
	const spec = readFileSync(join(dir, "harness.yaml"), "utf8");
	const hint = /hint:\s*"Try:\s*([^"·]+)/.exec(spec)?.[1]?.trim();
	const prompt = hint && !hint.includes("<") ? `${hint}. Answer in one or two sentences.` : "Reply with OK and the names of your custom tools.";
	const result = await liveCheck(dir, prompt);
	const tools = result.tools.map((t) => `${t.name}${t.isError ? "!" : ""}${t.view ? `→${t.view}` : ""}`).join(", ") || "none";
	console.log(`${result.ok ? "ok  " : "FAIL"} live  ${rel(dir)}  ${Math.round(result.ms / 1000)} s  tools: ${tools}`);
	console.log(`       ${(result.error ?? result.answer).replace(/\s+/g, " ").slice(0, 200)}`);
	if (!result.ok) failures.push(`${rel(dir)}: live check failed`);
}

heading("result");
if (failures.length === 0) console.log(apply ? "all harnesses up to date and passing" : "dry run passed; re-run with --apply to write");
else for (const f of failures) console.log(`✗ ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
