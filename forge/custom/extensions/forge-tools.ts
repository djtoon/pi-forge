import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { applyPlan, formatPlan, liveCheck, loadCheck, planHarness, REPO_ROOT, TEMPLATES_DIR } from "@forge/gen";
import {
	availableArt,
	availableThemes,
	availableViews,
	formatIssues,
	type HarnessSpec,
	listSkills,
	readSpecFile,
	validateSpec,
} from "@forge/harness-spec";
import { harnessCredentials } from "@forge/harness-web";
import type { DataTableData } from "../../forge_modules/views/data-table/types.ts";
import { viewResult, withViews } from "../../forge_modules/views/registry.ts";

// forge's own tools: inspect, validate, and generate harnesses. Results are data tables (data-table view).

const HARNESSES_DIR = join(REPO_ROOT, "harnesses");
const FORGE_DIR = join(REPO_ROOT, "forge");

function harnessDirs(): string[] {
	const dirs = existsSync(HARNESSES_DIR)
		? readdirSync(HARNESSES_DIR, { withFileTypes: true })
				.filter((e) => e.isDirectory() && existsSync(join(HARNESSES_DIR, e.name, "harness.yaml")))
				.map((e) => join(HARNESSES_DIR, e.name))
		: [];
	return [FORGE_DIR, ...dirs];
}

/** Accepts a harness name ("chem", "forge") or a path to a folder containing harness.yaml. */
function resolveHarness(ref: string): string {
	const candidates = [ref === "forge" ? FORGE_DIR : join(HARNESSES_DIR, ref), resolve(REPO_ROOT, ref), resolve(ref)];
	const found = candidates.find((dir) => existsSync(join(dir, "harness.yaml")));
	if (!found) {
		const known = harnessDirs().map((d) => relative(HARNESSES_DIR, d).replace(/^\.\.[\\/]/, ""));
		throw new Error(`No harness "${ref}". Known: ${known.join(", ")}`);
	}
	return found;
}

const rel = (dir: string) => relative(REPO_ROOT, dir).replace(/\\/g, "/") || ".";
const textOf = (t: DataTableData) => [t.title ?? "", t.columns.join(" | "), ...t.rows.map((r) => r.map((v) => v ?? "").join(" | "))].join("\n");
const callLine = (theme: Theme, label: string, detail: string) =>
	new Text(`${theme.fg("toolTitle", theme.bold(`${label} `))}${theme.fg("muted", detail)}`, 0, 0);

// -----------------------------------------------------------------------------

const forgeList = defineTool({
	name: "forge_list",
	label: "List",
	description:
		"List what forge knows about: existing harnesses (default), available views (with the domains they suit), themes, or header art.",
	parameters: Type.Object({
		what: Type.Optional(StringEnum(["harnesses", "views", "themes", "art"] as const, { description: "Default: harnesses" })),
	}),
	annotations: { readOnlyHint: true },
	async execute(_id, params) {
		const what = params.what ?? "harnesses";
		const ctx = { templatesDir: TEMPLATES_DIR };
		let table: DataTableData;

		if (what === "harnesses") {
			table = {
				title: "Harnesses",
				columns: ["Name", "Title", "Model", "Views", "Custom tools", "Generated", "Path"],
				rows: harnessDirs().map((dir) => {
					const spec = readSpecFile(dir) as Partial<HarnessSpec>;
					return [
						spec.name ?? "?",
						spec.title ?? "",
						spec.model?.id ?? "default",
						(spec.ui?.views ?? []).map((v) => v.id).join(", "),
						(spec.tools?.custom ?? []).join(", "),
						existsSync(join(dir, ".forge", "manifest.json")) ? "yes" : "no",
						rel(dir),
					];
				}),
			};
		} else if (what === "views") {
			table = {
				title: "Views (templates/views)",
				columns: ["Id", "Title", "Domains", "Panel", "Description"],
				rows: availableViews(ctx).map((id) => {
					const meta = JSON.parse(readFileSync(join(TEMPLATES_DIR, "views", id, "view.json"), "utf8")) as {
						title?: string;
						domains?: string[];
						panel?: boolean;
						description?: string;
					};
					return [id, meta.title ?? id, (meta.domains ?? []).join(", "), meta.panel ? "yes" : "no", meta.description ?? ""];
				}),
			};
		} else if (what === "themes") {
			table = {
				title: "Themes",
				columns: ["Name", "Kind"],
				rows: [
					...availableThemes(ctx).map((t) => [t, ["system", "dark", "light"].includes(t) ? "built-in" : "template"]),
					["{ name, base, accent }", "generated per harness from a base theme + accent color"],
				],
			};
		} else {
			const art = JSON.parse(readFileSync(join(TEMPLATES_DIR, "ui", "art.json"), "utf8")) as Record<string, string[]>;
			table = {
				title: "Header art",
				columns: ["Name", "Preview"],
				rows: availableArt(ctx).map((name) => [name, (art[name] ?? []).join(" ⏎ ")]),
			};
		}
		return viewResult(textOf(table), "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "forge list", args.what ?? "harnesses"),
});

const forgeValidate = defineTool({
	name: "forge_validate",
	// Reads files other tools may be writing in the same turn: never run in parallel with them.
	executionMode: "sequential",
	label: "Validate",
	description: "Validate a harness.yaml: schema, known views/themes/art/tools. Returns every error and warning with its path.",
	parameters: Type.Object({
		harness: Type.String({ description: 'Harness name (e.g. "chem", "forge") or a path to its folder' }),
	}),
	annotations: { readOnlyHint: true },
	async execute(_id, params) {
		const dir = resolveHarness(params.harness);
		const result = validateSpec(readSpecFile(dir), { templatesDir: TEMPLATES_DIR, harnessDir: dir });
		const table: DataTableData = {
			title: `${rel(dir)}/harness.yaml: ${result.ok ? "valid" : "invalid"}`,
			columns: ["Severity", "Path", "Message"],
			rows: result.issues.map((i) => [i.severity, i.path, i.message]),
		};
		return viewResult(`${table.title}\n${formatIssues(result.issues)}`, "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "forge validate", args.harness),
});

const forgeGenerate = defineTool({
	name: "forge_generate",
	// Reads files other tools may be writing in the same turn: never run in parallel with them.
	executionMode: "sequential",
	label: "Generate",
	description:
		"Generate (or regenerate) a harness folder from its harness.yaml and the templates. Without apply it only shows the planned file changes. " +
		"With apply it writes them; it refuses to overwrite generated files that were edited by hand unless force is set. Never touches custom/.",
	parameters: Type.Object({
		harness: Type.String({ description: 'Harness name (e.g. "chem", "forge") or a path to its folder' }),
		apply: Type.Optional(Type.Boolean({ description: "Write the changes. Default false (dry run)." })),
		force: Type.Optional(Type.Boolean({ description: "Overwrite hand-edited generated files. Only when the user asked." })),
	}),
	async execute(_id, params, _signal, _onUpdate, ctx) {
		const dir = resolveHarness(params.harness);
		const plan = planHarness(dir);
		const summary = formatPlan(plan);
		const pending = plan.changes.filter((c) => c.kind !== "unchanged");
		const table: DataTableData = {
			title: `${rel(dir)}: ${pending.length} file change(s)`,
			columns: ["Change", "Path", "+", "-", "Conflict"],
			rows: plan.issues.some((i) => i.severity === "error")
				? plan.issues.map((i) => [i.severity, i.path, null, null, i.message])
				: pending.map((c) => [c.kind, c.path, c.added, c.removed, c.conflict ?? ""]),
		};

		if (!params.apply || pending.length === 0) {
			const note = pending.length === 0 ? "Nothing to do: the harness matches its spec." : "Dry run. Call again with apply: true to write.";
			return viewResult(`${summary}\n${note}`, "data-table", table);
		}
		if (ctx.hasUI) {
			const ok = await ctx.ui.confirm("Generate harness", `Write ${pending.length} file change(s) to ${rel(dir)}?`);
			if (!ok) return viewResult(`${summary}\nThe user declined; nothing was written.`, "data-table", table);
		}
		const result = applyPlan(plan, { force: params.force });
		const name = (plan.spec?.name ?? "harness") as string;
		const run = dir === FORGE_DIR ? "forge reloads its own changes after /reload" : `run it: node ${rel(dir)}/bin/${name}.ts`;
		return viewResult(
			`${summary}\nApplied: ${result.written.length} written, ${result.deleted.length} deleted. ${run}`,
			"data-table",
			{ ...table, title: `${rel(dir)}: applied ${result.written.length + result.deleted.length} change(s)` },
		);
	},
	renderCall: (args, theme) => callLine(theme, "forge generate", `${args.harness}${args.apply ? " (apply)" : " (dry run)"}`),
});

// -----------------------------------------------------------------------------
// Phase 4: creating harnesses and interviewing the user
// -----------------------------------------------------------------------------

const forgeInit = defineTool({
	name: "forge_init",
	// Reads files other tools may be writing in the same turn: never run in parallel with them.
	executionMode: "sequential",
	label: "Init",
	description:
		"Create a new, empty harness folder harnesses/<name>/ with a minimal harness.yaml and the custom/ folders. " +
		"Fails if it already exists. Fill in harness.yaml afterwards, then forge_validate and forge_generate.",
	parameters: Type.Object({
		name: Type.String({ pattern: "^[a-z][a-z0-9-]{0,39}$", description: "CLI name: lowercase letters, digits, dashes" }),
		title: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
	}),
	async execute(_id, params, _signal, _onUpdate, ctx) {
		const dir = join(HARNESSES_DIR, params.name);
		if (params.name === "forge" || existsSync(dir)) throw new Error(`${rel(dir)} already exists. Pick another name or edit it instead.`);
		for (const sub of ["custom/extensions", "custom/lib", "custom/views", "custom/skills"]) {
			mkdirSync(join(dir, sub), { recursive: true });
			writeFileSync(join(dir, sub, ".gitkeep"), "");
		}
		const yaml = [
			"# yaml-language-server: $schema=../../schema/harness.schema.json",
			`name: ${params.name}`,
			`title: ${JSON.stringify(params.title ?? params.name)}`,
			`description: ${JSON.stringify(params.description ?? "")}`,
			"pi_version: 1.0.0",
			"",
			"model:",
			// The new harness starts on the model pi-Forge itself is running on.
			`  provider: ${ctx.model?.provider ?? "anthropic"}`,
			`  id: ${ctx.model?.id ?? "claude-opus-5-5"}`,
			"  thinking: medium",
			"",
			"tools:",
			"  builtin: [read, write, edit, bash, grep, find, ls]",
			"  custom: []",
			"",
			"guards:",
			'  protected_paths: [".env", "**/*.key", "**/*.pem"]',
			'  confirm_bash: ["rm -rf", "git push --force", "Remove-Item -Recurse"]',
			"",
			"ui:",
			"  theme: system",
			"  quiet_startup: header",
			"  header: { art: none }",
			"  views: []",
			"",
		].join("\n");
		writeFileSync(join(dir, "harness.yaml"), yaml);
		const table: DataTableData = {
			title: `Created ${rel(dir)}`,
			columns: ["Path", "Purpose"],
			rows: [
				[`${rel(dir)}/harness.yaml`, "the spec: edit this"],
				[`${rel(dir)}/custom/extensions/`, "custom tools (*.ts), never overwritten"],
				[`${rel(dir)}/custom/lib/`, "helpers for custom tools"],
				[`${rel(dir)}/custom/views/`, "domain views not in templates/views"],
				[`${rel(dir)}/custom/skills/`, "skills for the harness's agent"],
			],
		};
		return viewResult(`${textOf(table)}\nNext: fill in harness.yaml, then forge_validate.`, "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "forge init", args.name),
});

const Question = Type.Object({
	id: Type.String({ description: "Short key for the answer, e.g. domain, tools, theme" }),
	prompt: Type.String({ description: "The question as the user sees it" }),
	options: Type.Optional(
		Type.Array(
			Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) }),
			{ description: "Choices. Omit for a free-text question. Put the recommended choice first." },
		),
	),
	multi: Type.Optional(Type.Boolean({ description: "Allow picking several options" })),
	allow_other: Type.Optional(Type.Boolean({ description: "Ignored: every question with options also takes a typed answer." })),
	optional: Type.Optional(Type.Boolean({ description: "The user may leave it empty" })),
	placeholder: Type.Optional(Type.String({ description: "Hint for free-text questions" })),
});

const OTHER = "Other… (type your own)";
const DONE = "✓ Done";
const BACK = "← Back";
const ALL = "Select all";
const NONE = "Clear all";
/** Title of the editor request the web UI shows as a questionnaire form (other clients see editable JSON). */
const FORM_TITLE = "forge:questionnaire";

interface QuestionSpec {
	id: string;
	prompt: string;
	options?: { label: string; description?: string }[];
	multi?: boolean;
	allow_other?: boolean;
	optional?: boolean;
	placeholder?: string;
}

/** Added to every questionnaire: room for whatever the questions missed. */
const ANYTHING_ELSE: QuestionSpec = {
	id: "anything_else",
	prompt: "Anything else I should know that these questions didn't cover?",
	placeholder: "Requirements, examples, things to avoid, links… or leave empty",
	optional: true,
};

/** Web UI: the whole questionnaire as one form (checkboxes, select all, back/next). undefined = cancelled. */
async function askWithForm(ctx: ExtensionContext, title: string | undefined, questions: QuestionSpec[]): Promise<string[] | undefined> {
	const raw = await ctx.ui.editor(FORM_TITLE, JSON.stringify({ v: 1, title, questions }, null, 2));
	if (raw === undefined) return undefined;
	let parsed: { cancelled?: boolean; answers?: { id: string; values?: string[] }[] };
	try {
		parsed = JSON.parse(raw) as typeof parsed;
	} catch {
		throw new Error("The questionnaire answer was not valid JSON.");
	}
	if (parsed.cancelled) return undefined;
	return questions.map((q) => {
		const values = parsed.answers?.find((a) => a.id === q.id)?.values ?? [];
		return values.map((v) => v.trim()).filter(Boolean).join(", ");
	});
}

/** Terminal: one dialog per question, with Back, and Select all / Clear all for longer lists. */
async function askStepByStep(ctx: ExtensionContext, title: string | undefined, questions: QuestionSpec[]): Promise<string[] | undefined> {
	const label = (o: { label: string; description?: string }) => (o.description ? `${o.label} — ${o.description}` : o.label);
	const prefix = title ? `${title} · ` : "";
	const answers: (string | undefined)[] = questions.map(() => undefined);
	let i = 0;
	while (i < questions.length) {
		const q = questions[i] as QuestionSpec;
		const heading = `${prefix}${q.prompt}${questions.length > 1 ? ` (${i + 1}/${questions.length})` : ""}`;
		const options = q.options ?? [];
		const allowOther = true;
		const back = i > 0 ? [BACK] : [];
		let answer: string | undefined;
		let goBack = false;

		if (options.length === 0) {
			const typed = await ctx.ui.input(heading, `${q.placeholder ?? ""}${i > 0 ? "  (type < to go back)" : ""}`.trim());
			if (typed?.trim() === "<" && i > 0) goBack = true;
			else answer = typed ?? (q.optional ? "" : undefined);
		} else if (!q.multi) {
			const choice = await ctx.ui.select(heading, [...options.map(label), ...(allowOther ? [OTHER] : []), ...back]);
			if (choice === BACK) goBack = true;
			else if (choice === OTHER) answer = await ctx.ui.input(heading, q.placeholder);
			else if (choice !== undefined) answer = options.find((o) => label(o) === choice)?.label ?? choice;
		} else {
			const picked = new Set<string>((answers[i] ?? "").split(", ").filter(Boolean));
			for (;;) {
				const items = options.map((o) => `${picked.has(o.label) ? "[x]" : "[ ]"} ${label(o)}`);
				const bulk = options.length >= 4 ? [ALL, NONE] : [];
				const choice = await ctx.ui.select(`${heading} (pick any, then Done)`, [DONE, ...bulk, ...items, ...(allowOther ? [OTHER] : []), ...back]);
				if (choice === undefined) break;
				if (choice === BACK) {
					goBack = true;
					break;
				}
				if (choice === DONE) {
					answer = [...picked].join(", ");
					break;
				}
				if (choice === ALL) for (const o of options) picked.add(o.label);
				else if (choice === NONE) picked.clear();
				else if (choice === OTHER) {
					const extra = await ctx.ui.input(heading, q.placeholder);
					if (extra) picked.add(extra);
				} else {
					const option = options[items.indexOf(choice)];
					if (option) picked.has(option.label) ? picked.delete(option.label) : picked.add(option.label);
				}
			}
		}

		if (goBack) {
			i--;
			continue;
		}
		if (answer === undefined) return undefined;
		answers[i] = answer;
		i++;
	}
	return answers.map((a) => a ?? "");
}

const forgeAsk = defineTool({
	name: "forge_ask",
	label: "Ask",
	description:
		"Ask the user one or more questions with real dialogs (works in the terminal and the web UI). Use it for the harness interview: " +
		"group 2-5 related questions per call, give options with the recommended one first, and keep free text for names and descriptions. " +
		"Every question with options also lets the user type their own answer, and an open 'anything else?' question is added at the end automatically: read it and act on it. " +
		"Fails in headless mode; then ask in your reply instead.",
	parameters: Type.Object({
		title: Type.Optional(Type.String({ description: "Shown before each question, e.g. 'Interview 2/6: tools'" })),
		questions: Type.Array(Question, { minItems: 1, maxItems: 8 }),
	}),
	executionMode: "sequential",
	async execute(_id, params, _signal, _onUpdate, ctx) {
		if (!ctx.hasUI) throw new Error("No interactive UI (print/json mode). Ask these questions in your reply instead.");
		const asked = params.questions as QuestionSpec[];
		const questions = asked.some((q) => q.id === ANYTHING_ELSE.id) ? asked : [...asked, ANYTHING_ELSE];
		const values =
			ctx.mode === "rpc" ? await askWithForm(ctx, params.title, questions) : await askStepByStep(ctx, params.title, questions);

		if (values === undefined) {
			const table: DataTableData = { title: "Interview cancelled", columns: ["Id", "Question", "Answer"], rows: questions.map((q) => [q.id, q.prompt, "(cancelled)"]) };
			return viewResult("The user cancelled the questions. Ask whether to continue, or proceed with sensible defaults if they said so earlier.", "data-table", table);
		}
		const answers = questions.map((q, i) => ({
			id: q.id,
			prompt: q.prompt,
			answer: values[i]?.trim() || (q.id === ANYTHING_ELSE.id ? "(nothing to add)" : "(skipped: use your recommended default)"),
		}));
		const table: DataTableData = { title: params.title ?? "Answers", columns: ["Id", "Question", "Answer"], rows: answers.map((a) => [a.id, a.prompt, a.answer]) };
		return viewResult(`Answers:\n${answers.map((a) => `- ${a.id}: ${a.answer}`).join("\n")}`, "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "forge ask", `${args.questions.length} question(s)`),
});

// -----------------------------------------------------------------------------
// Phase 5b/6: testing harnesses and views
// -----------------------------------------------------------------------------

const forgeSmoke = defineTool({
	name: "forge_smoke",
	// Reads files other tools may be writing in the same turn: never run in parallel with them.
	executionMode: "sequential",
	label: "Smoke test",
	description:
		"Smoke-test a generated harness. Always runs a free load check (starts it headless, proves every extension loads). " +
		"With a prompt it also runs that prompt headless and reports tool calls, views, and the answer (costs model tokens).",
	parameters: Type.Object({
		harness: Type.String({ description: 'Harness name or folder, e.g. "chem"' }),
		prompt: Type.Optional(Type.String({ description: "Optional live prompt that should exercise the harness's tools" })),
	}),
	async execute(_id, params, _signal, onUpdate) {
		const dir = resolveHarness(params.harness);
		const load = await loadCheck(dir);
		const rows: (string | number | null)[][] = [
			["load", load.ok ? "ok" : "FAILED", `${load.ms} ms`, load.ok ? `model ${load.model}, ${load.commands} commands` : (load.error ?? ""), load.stderr.join(" ⏎ ")],
		];
		if (load.ok) {
			// Every valid SKILL.md must have loaded; pi skips broken ones without an error.
			const declared = listSkills(dir).filter((sk) => !sk.problem).map((sk) => sk.name as string);
			const notLoaded = declared.filter((name) => !load.skills.includes(name));
			rows.push([
				"skills",
				notLoaded.length ? "FAILED" : declared.length ? "ok" : "none",
				null,
				load.skills.length ? `loaded: ${load.skills.join(", ")}` : "no skills in custom/skills",
				notLoaded.length ? `not loaded: ${notLoaded.join(", ")} (run forge_validate)` : "",
			]);
			const spec = readSpecFile(dir) as HarnessSpec;
			if (spec.credentials?.length) {
				const status = harnessCredentials(spec).status();
				const missing = status.filter((g) => !g.configured && g.fields.some((f) => !f.optional)).map((g) => g.label);
				rows.push([
					"keys",
					missing.length ? "not set" : "ok",
					null,
					status.map((g) => `${g.label}: ${g.configured ? "set" : "missing"}`).join(", "),
					missing.length ? `The user adds them in Settings → ${spec.title ?? spec.name} keys, or with /keys in the terminal. Tools that need them report it clearly until then.` : "",
				]);
			}
		}
		if (load.ok && params.prompt) {
			onUpdate?.({ content: [{ type: "text", text: "load ok; running live prompt…" }], details: undefined });
			const live = await liveCheck(dir, params.prompt);
			const tools = live.tools.map((t) => `${t.name}${t.isError ? " (error)" : ""}${t.view ? ` → ${t.view}` : ""}`).join(", ");
			rows.push(["live", live.ok ? "ok" : "FAILED", `${Math.round(live.ms / 1000)} s`, `tools: ${tools || "none"}`, live.error ?? live.answer.slice(0, 300)]);
		}
		const table: DataTableData = { title: `Smoke test: ${rel(dir)}`, columns: ["Check", "Result", "Time", "Detail", "Output / errors"], rows };
		return viewResult(textOf(table), "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "forge smoke", `${args.harness}${args.prompt ? " + live prompt" : ""}`),
});

function viewDir(view: string, harness?: string): string {
	if (harness) {
		const dir = join(resolveHarness(harness), "custom", "views", view);
		if (existsSync(join(dir, "view.json"))) return dir;
	}
	const template = join(TEMPLATES_DIR, "views", view);
	if (existsSync(join(template, "view.json"))) return template;
	throw new Error(`No view "${view}" in ${harness ? `${harness}/custom/views or ` : ""}templates/views`);
}

const forgeCheckView = defineTool({
	name: "forge_check_view",
	// Reads files other tools may be writing in the same turn: never run in parallel with them.
	executionMode: "sequential",
	label: "Check view",
	description:
		"Check a view folder: view.json fields, files present, tui.ts exports renderTui/summarize and renders sample.json within the terminal width, " +
		"web.js exports render(el, data, ctx). Looks in <harness>/custom/views/<view> first, then templates/views/<view>.",
	parameters: Type.Object({
		view: Type.String({ description: "View id" }),
		harness: Type.Optional(Type.String({ description: "Harness whose custom/views to look in" })),
	}),
	annotations: { readOnlyHint: true },
	async execute(_id, params) {
		const dir = viewDir(params.view, params.harness);
		const script = join(REPO_ROOT, "packages", "forge-gen", "src", "check-view.ts");
		const output = await new Promise<string>((resolveRun) => {
			const child = spawn(process.execPath, [script, dir], { stdio: ["ignore", "pipe", "pipe"] });
			let out = "";
			child.stdout.on("data", (d: Buffer) => {
				out += d.toString("utf8");
			});
			child.on("exit", () => resolveRun(out));
		});
		const [report] = JSON.parse(output.slice(output.indexOf("["))) as {
			ok: boolean;
			errors: string[];
			warnings: string[];
			summary?: string;
			preview?: string[];
		}[];
		if (!report) throw new Error(`view check produced no report: ${output.slice(0, 500)}`);
		const table: DataTableData = {
			title: `View ${params.view} (${rel(dir)}): ${report.ok ? "ok" : "FAILED"}`,
			columns: ["Kind", "Message"],
			rows: [
				...report.errors.map((e) => ["error", e]),
				...report.warnings.map((w) => ["warning", w]),
				["summary", report.summary ?? ""],
				...(report.preview ?? []).map((l) => ["terminal", l]),
			],
		};
		return viewResult(textOf(table), "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "forge check view", args.view),
});

const forgePromoteView = defineTool({
	name: "forge_promote_view",
	// Reads files other tools may be writing in the same turn: never run in parallel with them.
	executionMode: "sequential",
	label: "Promote view",
	description:
		"Copy a checked custom view from <harness>/custom/views/<view> into templates/views/<view> so every harness can use it. " +
		"Run forge_check_view first; asks the user to confirm.",
	parameters: Type.Object({
		harness: Type.String(),
		view: Type.String(),
	}),
	async execute(_id, params, _signal, _onUpdate, ctx) {
		const from = join(resolveHarness(params.harness), "custom", "views", params.view);
		const to = join(TEMPLATES_DIR, "views", params.view);
		if (!existsSync(join(from, "view.json"))) throw new Error(`${rel(from)} is not a view folder`);
		if (existsSync(to)) throw new Error(`templates/views/${params.view} already exists`);
		if (ctx.hasUI && !(await ctx.ui.confirm("Promote view", `Copy ${rel(from)} to templates/views/${params.view}?`))) {
			throw new Error("The user declined.");
		}
		cpSync(from, to, { recursive: true });
		const table: DataTableData = {
			title: `Promoted ${params.view}`,
			columns: ["From", "To", "Next"],
			rows: [[rel(from), rel(to), `remove custom/views/${params.view} from ${params.harness} and regenerate it to use the template copy`]],
		};
		return viewResult(textOf(table), "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "forge promote view", `${args.harness}/${args.view}`),
});

const forgePackage = defineTool({
	name: "forge_package",
	label: "Package",
	description:
		"Package a generated harness as a standalone program (Bun-compiled executable plus its harness, web UI and assets in one folder). " +
		"The result runs without Node, npm, or this repo: `<name> web` for the browser UI, `<name>` for the terminal, `-p` for headless. " +
		"Default target is this computer; cross-compile with target. Run forge_smoke first.",
	parameters: Type.Object({
		harness: Type.String({ description: 'Harness name or folder, e.g. "chem"' }),
		target: Type.Optional(
			StringEnum(["windows-x64", "windows-arm64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"] as const, {
				description: "Platform to build for. Default: this computer.",
			}),
		),
	}),
	executionMode: "sequential",
	async execute(_id, params, signal, onUpdate) {
		const dir = resolveHarness(params.harness);
		onUpdate?.({ content: [{ type: "text", text: "compiling (this takes up to a minute)…" }], details: undefined });
		const script = join(REPO_ROOT, "packages", "forge-gen", "src", "pack.ts");
		const args = [script, dir, ...(params.target ? ["--target", params.target] : [])];
		const { code, out } = await new Promise<{ code: number; out: string }>((resolveRun) => {
			const child = spawn(process.execPath, args, { cwd: REPO_ROOT, signal, stdio: ["ignore", "pipe", "pipe"] });
			let text = "";
			child.stdout.on("data", (d: Buffer) => {
				text += d.toString("utf8");
			});
			child.stderr.on("data", (d: Buffer) => {
				text += d.toString("utf8");
			});
			child.on("close", (c) => resolveRun({ code: c ?? 1, out: text }));
			child.on("error", (e) => resolveRun({ code: 1, out: e.message }));
		});
		const clean = out
			.split(/\r?\n/)
			.filter((l) => l.trim() && !/ExperimentalWarning|trace-warnings|DeprecationWarning/.test(l))
			.join("\n");
		if (code !== 0) throw new Error(`Packaging failed:\n${clean.slice(-2000)}`);
		const match = /packaged (.+) \((\S+), (\d+) MB\)/.exec(clean);
		const outDir = match?.[1] ?? "dist";
		const name = (readSpecFile(dir) as { name?: string }).name ?? params.harness;
		const exe = (match?.[2] ?? "").startsWith("windows") ? `${name}.exe` : name;
		const table: DataTableData = {
			title: `Packaged ${name} (${match?.[2] ?? "?"}, ${match?.[3] ?? "?"} MB)`,
			columns: ["What", "Value"],
			rows: [
				["Folder", outDir],
				["Browser UI", `${outDir}/${exe} web`],
				["Terminal UI", `${outDir}/${exe}`],
				["Headless", `${outDir}/${exe} -p "…"`],
				["Share", "zip the whole folder; the program loads harness/, web/ and theme/ from next to itself"],
			],
		};
		return viewResult(`${clean}\nShare the whole folder ${outDir}.`, "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "forge package", `${args.harness}${args.target ? ` (${args.target})` : ""}`),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(withViews(forgePackage));
	pi.registerTool(withViews(forgeList));
	pi.registerTool(withViews(forgeValidate));
	pi.registerTool(withViews(forgeGenerate));
	pi.registerTool(withViews(forgeInit));
	pi.registerTool(withViews(forgeAsk));
	pi.registerTool(withViews(forgeSmoke));
	pi.registerTool(withViews(forgeCheckView));
	pi.registerTool(withViews(forgePromoteView));
}
