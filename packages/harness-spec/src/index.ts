import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Errors } from "typebox/value";
import { parse } from "yaml";

// =============================================================================
// Schema: the single definition of harness.yaml. schema/harness.schema.json is exported from it.
// =============================================================================

const Thinking = Type.Union(
	["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((v) => Type.Literal(v)),
	{ description: "Reasoning effort" },
);

const ThemeSpec = Type.Union([
	Type.String({ description: "Built-in theme (system, dark, light) or a theme in templates/themes/" }),
	Type.Object(
		{
			name: Type.String({ pattern: "^[a-z][a-z0-9-]*$" }),
			base: Type.Union([Type.Literal("dark"), Type.Literal("light")]),
			accent: Type.String({ description: "Color: #hex, okhsl(h s% l%), or oklch(...)" }),
			border: Type.Optional(Type.String()),
		},
		{ additionalProperties: false, description: "Generated theme: a base theme with a new accent color" },
	),
]);

const ViewUse = Type.Object(
	{
		id: Type.String({ description: "View id from templates/views/ or custom/views/" }),
		shows: Type.Array(Type.String(), { description: "Tools whose results render in this view. Supports * wildcards." }),
		panel: Type.Optional(
			Type.Union([Type.Literal("right"), Type.Literal("left"), Type.Literal("bottom")], {
				description: "Also pin the latest result as a panel (web) / widget (terminal)",
			}),
		),
	},
	{ additionalProperties: false },
);

export const HarnessSchema = Type.Object(
	{
		name: Type.String({ pattern: "^[a-z][a-z0-9-]{0,39}$", description: "CLI name and config folder (~/.forge/<name>)" }),
		title: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		pi_version: Type.Optional(Type.String()),
		model: Type.Optional(
			Type.Object(
				{ provider: Type.Optional(Type.String()), id: Type.Optional(Type.String()), thinking: Type.Optional(Thinking) },
				{ additionalProperties: false },
			),
		),
		tools: Type.Optional(
			Type.Object(
				{
					builtin: Type.Optional(Type.Array(Type.String(), { description: "pi built-in tools to enable" })),
					custom: Type.Optional(Type.Array(Type.String(), { description: "Tools registered by custom/extensions" })),
					plan: Type.Optional(Type.Boolean({ description: "Built-in update_plan tool: a live checklist the user sees. Default true." })),
				},
				{ additionalProperties: false },
			),
		),
		guards: Type.Optional(
			Type.Object(
				{
					protected_paths: Type.Optional(Type.Array(Type.String(), { description: "Globs write/edit may not touch" })),
					confirm_bash: Type.Optional(Type.Array(Type.String(), { description: "Substrings that need confirmation" })),
				},
				{ additionalProperties: false },
			),
		),
		prompt: Type.Optional(
			Type.Object(
				{ system: Type.Optional(Type.String({ description: "Appended to pi's system prompt" })) },
				{ additionalProperties: false },
			),
		),
		ui: Type.Optional(
			Type.Object(
				{
					theme: Type.Optional(ThemeSpec),
					quiet_startup: Type.Optional(Type.Union([Type.Boolean(), Type.Literal("header")])),
					header: Type.Optional(
						Type.Object(
							{ art: Type.Optional(Type.String()), hint: Type.Optional(Type.String()) },
							{ additionalProperties: false },
						),
					),
					web: Type.Optional(
						Type.Object(
							{
								port: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535 })),
								layout: Type.Optional(Type.String()),
								headline: Type.Optional(Type.String({ description: "Welcome screen headline, e.g. 'Build your next agent harness.'" })),
								subtitle: Type.Optional(Type.String({ description: "Line under the headline. Default: description" })),
								placeholder: Type.Optional(Type.String({ description: "Message box placeholder" })),
								eyebrow: Type.Optional(Type.String({ description: "Small mono label above the headline, e.g. AI HARNESS BUILDER" })),
								tagline: Type.Optional(Type.String({ description: "Mono line under the welcome cards, e.g. Build. Validate. Update." })),
							},
							{ additionalProperties: false },
						),
					),
					views: Type.Optional(Type.Array(ViewUse)),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false, $id: "https://forge.local/harness.schema.json", title: "pi-Forge harness.yaml" },
);

export type HarnessSpec = Static<typeof HarnessSchema>;
export type ThemeSpecValue = Static<typeof ThemeSpec>;
export type ViewUseValue = Static<typeof ViewUse>;

export const BUILTIN_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls", "powershell", "codemode", "tool_search"];
export const BUILTIN_THEMES = ["system", "dark", "light"];

// =============================================================================
// Loading and validation
// =============================================================================

export interface Issue {
	path: string;
	message: string;
	severity: "error" | "warning";
}

export interface ValidationResult {
	ok: boolean;
	spec?: HarnessSpec;
	issues: Issue[];
}

export interface ValidateContext {
	/** Repo templates/ folder: views, themes, art. */
	templatesDir: string;
	/** The harness folder, for custom/views. */
	harnessDir?: string;
	/** Installed pi version; a different pi_version in the spec is reported as a warning. */
	piVersion?: string;
}

function listDirs(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name);
}

export function availableViews(ctx: ValidateContext): string[] {
	const ids = new Set<string>();
	for (const base of [join(ctx.templatesDir, "views"), ctx.harnessDir ? join(ctx.harnessDir, "custom", "views") : ""]) {
		if (!base) continue;
		for (const id of listDirs(base)) if (existsSync(join(base, id, "view.json"))) ids.add(id);
	}
	return [...ids].sort();
}

export function availableThemes(ctx: ValidateContext): string[] {
	const dir = join(ctx.templatesDir, "themes");
	const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
	return [...BUILTIN_THEMES, ...files.map((f) => f.slice(0, -5))];
}

export function availableArt(ctx: ValidateContext): string[] {
	const file = join(ctx.templatesDir, "ui", "art.json");
	return existsSync(file) ? Object.keys(JSON.parse(readFileSync(file, "utf8")) as object) : [];
}

function wildcardToRegExp(pattern: string): RegExp {
	return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
}

/** Converts typebox errors into one readable message per location. */
function structuralIssues(value: unknown): Issue[] {
	const byPath = new Map<string, string>();
	for (const error of Errors(HarnessSchema, value)) {
		if (error.keyword === "boolean") continue;
		const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".") || "(root)";
		let message = error.message;
		if (error.keyword === "additionalProperties") {
			const extra = (error.params as { additionalProperties?: string[] }).additionalProperties ?? [];
			message = `unknown key(s): ${extra.join(", ")}`;
		}
		if (error.schemaPath.includes("anyOf")) message = "does not match any allowed form";
		const prev = byPath.get(path);
		if (!prev || prev === "does not match any allowed form") byPath.set(path, message);
	}
	return [...byPath].map(([path, message]) => ({ path, message, severity: "error" as const }));
}

function semanticIssues(spec: HarnessSpec, ctx: ValidateContext): Issue[] {
	const issues: Issue[] = [];
	const err = (path: string, message: string) => issues.push({ path, message, severity: "error" });
	const warn = (path: string, message: string) => issues.push({ path, message, severity: "warning" });

	(spec.tools?.builtin ?? []).forEach((tool, i) => {
		if (!BUILTIN_TOOLS.includes(tool)) err(`tools.builtin.${i}`, `unknown built-in tool "${tool}". Known: ${BUILTIN_TOOLS.join(", ")}`);
	});

	const theme = spec.ui?.theme;
	if (typeof theme === "string" && !availableThemes(ctx).includes(theme)) {
		err("ui.theme", `unknown theme "${theme}". Available: ${availableThemes(ctx).join(", ")}`);
	}
	if (typeof theme === "object" && BUILTIN_THEMES.includes(theme.name)) {
		err("ui.theme.name", `"${theme.name}" is a built-in theme name; pick another`);
	}

	const art = spec.ui?.header?.art;
	if (art && !availableArt(ctx).includes(art)) err("ui.header.art", `unknown art "${art}". Available: ${availableArt(ctx).join(", ")}`);

	const views = availableViews(ctx);
	const knownTools = [...(spec.tools?.builtin ?? []), ...(spec.tools?.custom ?? [])];
	const seen = new Set<string>();
	(spec.ui?.views ?? []).forEach((view, i) => {
		if (!views.includes(view.id)) err(`ui.views.${i}.id`, `unknown view "${view.id}". Available: ${views.join(", ") || "none"}`);
		if (seen.has(view.id)) err(`ui.views.${i}.id`, `view "${view.id}" is listed twice`);
		seen.add(view.id);
		view.shows.forEach((pattern, j) => {
			const re = wildcardToRegExp(pattern);
			if (!knownTools.some((t) => re.test(t))) {
				warn(`ui.views.${i}.shows.${j}`, `"${pattern}" matches no tool in tools.builtin or tools.custom`);
			}
		});
	});

	if (spec.model && (!spec.model.provider || !spec.model.id)) warn("model", "set both provider and id, or pi picks a default model");
	if (ctx.harnessDir && !existsSync(join(ctx.harnessDir, "custom", "brand", "mark.svg"))) {
		warn("ui", "no logo: add custom/brand/mark.svg (single-color 48x48 mark; see the harness-interview skill)");
	}
	if (ctx.piVersion && spec.pi_version && spec.pi_version !== ctx.piVersion) {
		warn("pi_version", `spec says ${spec.pi_version} but pi ${ctx.piVersion} is installed: run npm run upgrade`);
	}
	return issues;
}

/** Structural check always; semantic checks (views, themes, art exist) only when ctx is given. */
export function validateSpec(value: unknown, ctx?: ValidateContext): ValidationResult {
	const structural = structuralIssues(value);
	if (structural.length > 0) return { ok: false, issues: structural };
	const spec = value as HarnessSpec;
	const issues = ctx ? semanticIssues(spec, ctx) : [];
	return { ok: !issues.some((i) => i.severity === "error"), spec, issues };
}

export function readSpecFile(harnessDir: string): unknown {
	const file = join(harnessDir, "harness.yaml");
	if (!existsSync(file)) throw new Error(`No harness.yaml in ${harnessDir}`);
	return parse(readFileSync(file, "utf8"));
}

/** Loads and validates; throws with all errors listed when invalid. */
export function loadSpec(harnessDir: string, ctx?: ValidateContext): HarnessSpec {
	const result = validateSpec(readSpecFile(harnessDir), ctx ? { ...ctx, harnessDir } : undefined);
	if (!result.ok || !result.spec) {
		const lines = result.issues.filter((i) => i.severity === "error").map((i) => `  ${i.path}: ${i.message}`);
		throw new Error(`${join(harnessDir, "harness.yaml")} is invalid:\n${lines.join("\n")}`);
	}
	return result.spec;
}

export function formatIssues(issues: Issue[]): string {
	if (issues.length === 0) return "valid, no issues";
	return issues.map((i) => `${i.severity === "error" ? "✗" : "!"} ${i.path}: ${i.message}`).join("\n");
}

export function themeName(spec: HarnessSpec): string | undefined {
	const theme = spec.ui?.theme;
	return typeof theme === "string" ? theme : theme?.name;
}
