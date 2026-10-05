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

const CredentialFieldSpec = Type.Object(
	{
		env: Type.String({ pattern: "^[A-Z][A-Z0-9_]{1,63}$", description: "Environment variable the tools read, e.g. OPENWEATHER_API_KEY" }),
		label: Type.String({ description: "Field label in Settings, e.g. API key" }),
		secret: Type.Optional(Type.Boolean({ description: "Masked in Settings (default true). Set false for IDs, regions, paths." })),
		optional: Type.Optional(Type.Boolean({ description: "The tools work without it (default false)" })),
		placeholder: Type.Optional(Type.String({ description: "Example shown in the empty field, e.g. sk-… or us-east-1" })),
	},
	{ additionalProperties: false },
);

const CredentialGroupSpec = Type.Object(
	{
		id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,39}$", description: "Service id, e.g. openweather" }),
		label: Type.String({ description: "Service name shown in Settings, e.g. OpenWeather" }),
		note: Type.Optional(Type.String({ description: "One line for the user: what it unlocks, free tier, scopes to grant" })),
		url: Type.Optional(Type.String({ pattern: "^https://", description: "Where to get the key" })),
		tools: Type.Optional(Type.Array(Type.String(), { description: "Custom tools that need it" })),
		fields: Type.Array(CredentialFieldSpec, { minItems: 1 }),
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
		credentials: Type.Optional(
			Type.Array(CredentialGroupSpec, {
				description:
					"Keys and settings the custom tools need (API keys, account IDs, paths). Each service gets a card in the harness's Settings; saved values reach the tools as environment variables.",
			}),
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
export type CredentialGroupValue = Static<typeof CredentialGroupSpec>;
export type CredentialFieldValue = Static<typeof CredentialFieldSpec>;

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

/** Variables owned by Settings → Model providers (shared by every harness), so a harness can't declare them. */
export const PROVIDER_ENV = [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_OAUTH_TOKEN",
	"OPENAI_API_KEY",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"AWS_REGION",
	"AWS_PROFILE",
	"AWS_BEARER_TOKEN_BEDROCK",
	"GEMINI_API_KEY",
	"OPENROUTER_API_KEY",
	"MISTRAL_API_KEY",
	"GROQ_API_KEY",
	"XAI_API_KEY",
	"DEEPSEEK_API_KEY",
];

/** Variables that change how programs run (or belong to pi-Forge), never settable from a harness's Settings. */
export const RESERVED_ENV =
	/^(PATH|PATHEXT|HOME|USER|USERNAME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|TEMP|TMP|TMPDIR|SHELL|COMSPEC|SYSTEMROOT|WINDIR|LANG|TERM|NODE_OPTIONS|NODE_PATH|NODE_ENV|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|HTTPS?_PROXY|NO_PROXY|LD_\w+|DYLD_\w+|PI_\w+|FORGE_\w+|BUN_\w+|NPM_\w+|CI)$/;

/** A skill's SKILL.md: frontmatter (name, description) as pi reads it, or why pi won't load it. */
export interface SkillInfo {
	dir: string;
	path: string;
	name?: string;
	description?: string;
	problem?: string;
}

const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Every SKILL.md under custom/skills (pi discovers them recursively). */
export function listSkills(harnessDir: string): SkillInfo[] {
	const root = join(harnessDir, "custom", "skills");
	const out: SkillInfo[] = [];
	const walk = (dir: string, rel: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
			const sub = join(dir, entry.name);
			const subRel = rel ? `${rel}/${entry.name}` : entry.name;
			const file = join(sub, "SKILL.md");
			if (existsSync(file)) out.push(readSkill(file, entry.name, `custom/skills/${subRel}/SKILL.md`));
			else walk(sub, subRel);
		}
	};
	if (existsSync(root)) walk(root, "");
	return out;
}

function readSkill(file: string, dir: string, path: string): SkillInfo {
	const text = readFileSync(file, "utf8").replace(/^﻿/, "");
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
	if (!match) return { dir, path, problem: "no frontmatter: start with ---, name:, description:, ---" };
	let front: { name?: unknown; description?: unknown };
	try {
		front = (parse(match[1] ?? "") ?? {}) as typeof front;
	} catch (error) {
		return { dir, path, problem: `frontmatter is not valid YAML: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
	}
	const name = typeof front.name === "string" ? front.name.trim() : undefined;
	const description = typeof front.description === "string" ? front.description.trim() : undefined;
	let problem: string | undefined;
	if (!name) problem = "frontmatter has no name";
	else if (!SKILL_NAME.test(name) || name.length > 64) problem = `name "${name}" must be lowercase letters, numbers and single hyphens, at most 64 characters`;
	else if (!description) problem = "frontmatter has no description (pi skips skills without one)";
	else if (description.length > 1024) problem = `description is ${description.length} characters; the limit is 1024`;
	else if (!text.slice(match[0].length).trim()) problem = "no instructions after the frontmatter";
	return { dir, path, name, description, problem };
}

/** Upper-case environment variables that custom code reads (process.env.NAME or process.env["NAME"]). */
export function envReadsInCustomCode(harnessDir: string): Map<string, string[]> {
	const reads = new Map<string, string[]>();
	const re = /process\.env(?:\.([A-Z][A-Z0-9_]*)\b|\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\])/g;
	const walk = (dir: string, rel: string) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
			const full = join(dir, entry.name);
			const relPath = `${rel}/${entry.name}`;
			if (entry.isDirectory()) walk(full, relPath);
			else if (/\.(m?[jt]s)$/.test(entry.name)) {
				for (const m of readFileSync(full, "utf8").matchAll(re)) {
					const name = (m[1] ?? m[2]) as string;
					reads.set(name, [...new Set([...(reads.get(name) ?? []), relPath])]);
				}
			}
		}
	};
	walk(join(harnessDir, "custom", "extensions"), "custom/extensions");
	walk(join(harnessDir, "custom", "lib"), "custom/lib");
	return reads;
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

	// Credentials: unique services and variables, nothing that belongs to the system or to model providers.
	const groupIds = new Set<string>();
	const declaredEnv = new Map<string, string>();
	(spec.credentials ?? []).forEach((group, i) => {
		if (groupIds.has(group.id)) err(`credentials.${i}.id`, `service "${group.id}" is listed twice`);
		groupIds.add(group.id);
		(group.tools ?? []).forEach((tool, j) => {
			if (!(spec.tools?.custom ?? []).includes(tool)) warn(`credentials.${i}.tools.${j}`, `"${tool}" is not in tools.custom`);
		});
		group.fields.forEach((field, j) => {
			const path = `credentials.${i}.fields.${j}.env`;
			if (PROVIDER_ENV.includes(field.env)) err(path, `${field.env} is a model-provider key, set once in Settings → Model providers for every harness; tools can read it without declaring it`);
			else if (RESERVED_ENV.test(field.env)) err(path, `${field.env} is a system or pi-Forge variable and can't be set from Settings; pick a name like ${spec.name.toUpperCase().replace(/-/g, "_")}_${field.env}`);
			const other = declaredEnv.get(field.env);
			if (other) err(path, `${field.env} is already declared by service "${other}"`);
			declaredEnv.set(field.env, group.id);
		});
	});
	if (ctx.harnessDir) {
		for (const [name, files] of envReadsInCustomCode(ctx.harnessDir)) {
			if (declaredEnv.has(name) || PROVIDER_ENV.includes(name) || RESERVED_ENV.test(name)) continue;
			warn(
				"credentials",
				`${files.join(", ")} read${files.length === 1 ? "s" : ""} ${name}, which is not declared: add it under credentials so users can set it in Settings (secret: false for IDs and paths)`,
			);
		}
	}

	// Skills: pi silently skips a SKILL.md it can't read, so report why here.
	if (ctx.harnessDir) {
		const skills = listSkills(ctx.harnessDir);
		const names = new Map<string, string>();
		for (const skill of skills) {
			if (skill.problem) {
				err(skill.path, `${skill.problem}. pi will not load this skill`);
				continue;
			}
			const name = skill.name as string;
			const first = names.get(name);
			if (first) err(skill.path, `skill name "${name}" is already used by ${first}; pi keeps only the first`);
			names.set(name, skill.path);
			if (name !== skill.dir) warn(skill.path, `name "${name}" differs from its folder "${skill.dir}"; rename one so they match`);
		}
		if (skills.length === 0) warn("custom/skills", "no skills: add the harness's domain know-how as skills (see the skill-builder skill)");
	}

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
