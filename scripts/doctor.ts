#!/usr/bin/env node
/**
 * npm run doctor: checks that this machine can run pi-Forge, and says what to fix.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
let problems = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => console.log(`  ! ${msg}`);
const fail = (msg: string) => {
	problems++;
	console.log(`  ✗ ${msg}`);
};

console.log("pi-Forge doctor\n");

// Node: .ts files run directly, which needs type stripping (Node 22.18+ or 23.6+).
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18)) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node}: install Node 22.18 or newer (https://nodejs.org)`);

// Dependencies.
if (existsSync(join(root, "node_modules", "@earendil-works", "pi-coding-agent"))) ok("dependencies installed");
else fail("dependencies missing: run npm install");

// Windows: pi's bash tool uses Git Bash.
if (process.platform === "win32") {
	const gitBash = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].some((p) => existsSync(p));
	if (gitBash) ok("Git Bash found (used by the agent's bash tool)");
	else warn("Git Bash not found: install Git for Windows (https://git-scm.com) so agents can run shell commands");
}

// Bun: only needed to package harnesses as programs.
const bun = spawnSync(process.platform === "win32" ? "where" : "which", ["bun"], { encoding: "utf8" });
if (bun.status === 0) ok("Bun found (for npm run package)");
else warn("Bun not found: only needed to package harnesses as programs (https://bun.sh)");

// Model providers: environment, saved keys (Settings), or ~/.aws for Bedrock.
const env: Record<string, string[]> = {
	Anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
	OpenAI: ["OPENAI_API_KEY"],
	"AWS Bedrock": ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_BEARER_TOKEN_BEDROCK"],
	"Google Gemini": ["GEMINI_API_KEY"],
	OpenRouter: ["OPENROUTER_API_KEY"],
	Mistral: ["MISTRAL_API_KEY"],
	Groq: ["GROQ_API_KEY"],
	xAI: ["XAI_API_KEY"],
	DeepSeek: ["DEEPSEEK_API_KEY"],
};
const forgeHome = process.env.FORGE_HOME ?? join(homedir(), ".forge");
let saved: Record<string, string> = {};
try {
	saved = (JSON.parse(readFileSync(join(forgeHome, "credentials.json"), "utf8")) as { values?: Record<string, string> }).values ?? {};
} catch {
	// no saved keys
}
const found = Object.entries(env)
	.filter(([, vars]) => vars.some((v) => process.env[v] || saved[v]))
	.map(([name]) => name);
if (!found.includes("AWS Bedrock") && ["credentials", "config"].some((f) => existsSync(join(homedir(), ".aws", f)))) found.push("AWS Bedrock (~/.aws)");
if (found.length > 0) ok(`model provider: ${found.join(", ")}`);
else
	fail(
		"no model provider: set ANTHROPIC_API_KEY or OPENAI_API_KEY (or AWS credentials for Bedrock), or start the web UI (npm run forge -- web) and add a key under Settings",
	);

console.log(problems === 0 ? "\nReady. Start with: npm run forge -- web" : `\n${problems} problem(s) to fix first.`);
process.exit(problems === 0 ? 0 : 1);
