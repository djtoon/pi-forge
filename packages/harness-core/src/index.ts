import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { main } from "@earendil-works/pi-coding-agent";
import { type HarnessSpec, loadSpec, themeName } from "@forge/harness-spec";
import { applySavedCredentials, harnessCredentials, isPackagedBinary, startWeb } from "@forge/harness-web";

export type { HarnessSpec };

/** Where a harness keeps settings, sessions, and credentials. Separate from ~/.pi so harnesses never interfere. */
export function getHarnessAgentDir(name: string): string {
	const home = process.env.FORGE_HOME ?? join(homedir(), ".forge");
	return join(home, name);
}

function readJson(file: string): Record<string, unknown> {
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/**
 * Writes the harness-owned settings into the agent dir. harness.yaml is the source of truth:
 * keys derived from it are overwritten on every launch; all other keys (set via /settings) are kept.
 */
/** Environment variables that make each provider usable (pi reads the same ones). */
const PROVIDER_ENV: Record<string, string[]> = {
	anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"],
	openai: ["OPENAI_API_KEY"],
	google: ["GEMINI_API_KEY"],
	openrouter: ["OPENROUTER_API_KEY"],
	mistral: ["MISTRAL_API_KEY"],
	groq: ["GROQ_API_KEY"],
	xai: ["XAI_API_KEY"],
	deepseek: ["DEEPSEEK_API_KEY"],
	"amazon-bedrock": [
		"AWS_PROFILE",
		"AWS_ACCESS_KEY_ID",
		"AWS_BEARER_TOKEN_BEDROCK",
		"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
		"AWS_CONTAINER_CREDENTIALS_FULL_URI",
		"AWS_WEB_IDENTITY_TOKEN_FILE",
	],
};

/** Best-effort check that a provider can be used here: env vars, ~/.aws for Bedrock, or a pi /login credential. */
export function providerConfigured(provider: string, agentDir: string): boolean {
	const vars = PROVIDER_ENV[provider];
	if (!vars) return true; // a provider we do not know: trust the spec
	if (vars.some((v) => process.env[v])) return true;
	if (provider === "amazon-bedrock" && ["credentials", "config"].some((f) => existsSync(join(homedir(), ".aws", f)))) return true;
	return Boolean(readJson(join(agentDir, "auth.json"))[provider]);
}

export function syncAgentDir(harnessDir: string, spec: HarnessSpec, agentDir: string): void {
	mkdirSync(agentDir, { recursive: true });

	const settingsFile = join(agentDir, "settings.json");
	const settings = readJson(settingsFile);
	// The spec names a preferred model. Use it only when its provider has credentials on this machine;
	// otherwise pi picks a model from whatever provider is set up (and a value we wrote earlier is removed).
	const provider = spec.model?.provider;
	const id = spec.model?.id;
	// A Claude model on Bedrock ("global.anthropic.claude-opus-5-5") is the same model as Anthropic's "claude-opus-5-5".
	const anthropicId = provider === "amazon-bedrock" ? /anthropic\.(claude-[\w.-]+?)(?:-v\d+(?::\d+)?)?$/.exec(id ?? "")?.[1] : undefined;
	const choices: [string, string][] = [];
	if (provider && id) choices.push([provider, id]);
	if (anthropicId) choices.push(["anthropic", anthropicId]);
	const choice = choices.find(([p]) => providerConfigured(p, agentDir));
	if (choice) {
		[settings.defaultProvider, settings.defaultModel] = choice;
	} else if (choices.some(([p, m]) => settings.defaultProvider === p && settings.defaultModel === m)) {
		delete settings.defaultProvider;
		delete settings.defaultModel;
	}
	if (spec.model?.thinking) settings.defaultThinkingLevel = spec.model.thinking;
	const theme = themeName(spec);
	if (theme) settings.theme = theme;
	if (spec.ui?.quiet_startup !== undefined) settings.quietStartup = spec.ui.quiet_startup;
	if (spec.tools?.builtin) settings.defaultTools = spec.tools.builtin;

	// The harness directory is a pi package: its extensions/, skills/, prompts/, and themes/ load from here.
	// Exactly one copy of this harness may load: the one running now. Another copy of the same harness
	// (the repo checkout vs. a packaged build, or a moved folder) would register the same tools twice.
	const isOtherCopy = (entry: unknown) => {
		if (typeof entry !== "string" || entry === harnessDir) return false;
		const yaml = join(entry, "harness.yaml");
		if (!existsSync(yaml)) return !existsSync(entry) && /[\\/](harness|harnesses[\\/][^\\/]+|forge)$/.test(entry);
		return /^name:\s*(\S+)/m.exec(readFileSync(yaml, "utf8"))?.[1] === spec.name;
	};
	const packages = (Array.isArray(settings.packages) ? (settings.packages as unknown[]) : []).filter((p) => !isOtherCopy(p));
	if (!packages.includes(harnessDir)) packages.unshift(harnessDir);
	settings.packages = packages;
	writeFileSync(settingsFile, `${JSON.stringify(settings, null, "\t")}\n`);

	const appendSource = join(harnessDir, "APPEND_SYSTEM.md");
	const appendTarget = join(agentDir, "APPEND_SYSTEM.md");
	if (existsSync(appendSource)) copyFileSync(appendSource, appendTarget);
	else rmSync(appendTarget, { force: true });
}

/** The repo's templates/ folder when the harness lives inside a forge checkout (used by the view preview page). */
function findTemplatesDir(harnessDir: string): string | undefined {
	if (isPackagedBinary) return undefined;
	let dir = harnessDir;
	for (let i = 0; i < 4; i++) {
		if (existsSync(join(dir, "templates", "views"))) return join(dir, "templates");
		dir = dirname(dir);
	}
	return undefined;
}

function takeFlag(args: string[], name: string): string | true | undefined {
	const i = args.indexOf(name);
	if (i < 0) return undefined;
	const next = args[i + 1];
	if (next !== undefined && !next.startsWith("--")) {
		args.splice(i, 2);
		return next;
	}
	args.splice(i, 1);
	return true;
}

/**
 * Entry point for every harness launcher (bin/<name>.ts), including forge itself.
 *   <name> [pi args]            terminal UI, or headless with -p / --mode json / --mode rpc
 *   <name> web [--port N] [--no-open] [pi args]   browser UI with the harness's domain views
 */
export async function runHarness(harnessDir: string, args: string[] = process.argv.slice(2)): Promise<void> {
	const dir = resolve(harnessDir);
	const spec = loadSpec(dir);
	const agentDir = getHarnessAgentDir(spec.name);
	// Provider keys saved in Settings (~/.forge/credentials.json) apply to every harness and mode;
	// this harness's tool keys (credentials: in its spec, ~/.forge/<name>/credentials.json) apply to it alone.
	applySavedCredentials();
	harnessCredentials(spec).apply();
	syncAgentDir(dir, spec, agentDir);

	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.FORGE_HARNESS_NAME = spec.name;
	process.env.FORGE_HARNESS_DIR = dir;
	// Harness versions are pinned by forge; pi's own update notices do not apply.
	process.env.PI_SKIP_VERSION_CHECK ??= "1";

	if (args[0] === "web") {
		const rest = args.slice(1);
		const port = takeFlag(rest, "--port");
		const noOpen = takeFlag(rest, "--no-open");
		await startWeb({
			harnessDir: dir,
			spec,
			binPath: process.argv[1] ?? join(dir, "bin", `${spec.name}.ts`),
			args: rest,
			port: typeof port === "string" ? Number(port) : spec.ui?.web?.port,
			open: noOpen === undefined,
			templatesDir: findTemplatesDir(dir),
		});
		return;
	}

	await main([...skillArgs(dir, args), ...args]);
}

/**
 * A harness loads its own skills (custom/skills) and nothing else: without this, pi also picks up skills installed
 * on the machine (~/.agents/skills, a project's .agents/skills), so every harness would carry unrelated know-how.
 * Passing --no-skills or --skill yourself keeps pi's own behavior.
 */
function skillArgs(harnessDir: string, args: string[]): string[] {
	if (args.includes("--no-skills") || args.includes("-ns") || args.includes("--skill")) return [];
	const own = join(harnessDir, "custom", "skills");
	return existsSync(own) ? ["--no-skills", "--skill", own] : ["--no-skills"];
}

/**
 * Entry point of a forge-packaged executable: the harness folder ships next to it as ./harness.
 *   <name>.exe            terminal UI
 *   <name>.exe web        browser UI
 *   <name>.exe -p "…"     headless
 */
export async function runPackagedHarness(): Promise<void> {
	// Bun compiled executables: argv = [executable, <embedded entry path>, ...user args]
	const args = process.argv.slice(2);
	await runHarness(join(dirname(process.execPath), "harness"), args);
}
