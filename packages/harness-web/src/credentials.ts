import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Model provider credentials, shared by pi-Forge and every harness.
 *
 * Saved in <FORGE_HOME or ~/.forge>/credentials.json as { values: { ENV_NAME: value } } (owner-only file mode).
 * Every harness copies them into its process environment at startup (harness-core), which is how pi
 * and the AWS SDK read them. A saved value overrides the same variable from the shell environment.
 *
 * Only the variables listed in PROVIDERS can be saved, and secrets never leave this process in full:
 * the web UI only ever receives a masked preview.
 */

export interface CredentialField {
	env: string;
	label: string;
	secret: boolean;
	placeholder?: string;
	optional?: boolean;
}

export interface ProviderInfo {
	/** pi provider id (matches model.provider) */
	id: string;
	label: string;
	note?: string;
	fields: CredentialField[];
}

export const PROVIDERS: ProviderInfo[] = [
	{
		id: "anthropic",
		label: "Anthropic",
		fields: [{ env: "ANTHROPIC_API_KEY", label: "API key", secret: true, placeholder: "sk-ant-…" }],
	},
	{
		id: "openai",
		label: "OpenAI",
		fields: [{ env: "OPENAI_API_KEY", label: "API key", secret: true, placeholder: "sk-…" }],
	},
	{
		id: "amazon-bedrock",
		label: "AWS Bedrock",
		note: "Use an access key pair, a named AWS profile, or a Bedrock API key. Set the region your models are enabled in.",
		fields: [
			{ env: "AWS_ACCESS_KEY_ID", label: "Access key ID", secret: true, placeholder: "AKIA…", optional: true },
			{ env: "AWS_SECRET_ACCESS_KEY", label: "Secret access key", secret: true, optional: true },
			{ env: "AWS_SESSION_TOKEN", label: "Session token", secret: true, optional: true },
			{ env: "AWS_REGION", label: "Region", secret: false, placeholder: "us-east-1", optional: true },
			{ env: "AWS_PROFILE", label: "Profile (instead of keys)", secret: false, placeholder: "default", optional: true },
			{ env: "AWS_BEARER_TOKEN_BEDROCK", label: "Bedrock API key", secret: true, optional: true },
		],
	},
	{
		id: "google",
		label: "Google Gemini",
		fields: [{ env: "GEMINI_API_KEY", label: "API key", secret: true, placeholder: "AIza…" }],
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		fields: [{ env: "OPENROUTER_API_KEY", label: "API key", secret: true, placeholder: "sk-or-…" }],
	},
	{ id: "mistral", label: "Mistral", fields: [{ env: "MISTRAL_API_KEY", label: "API key", secret: true }] },
	{ id: "groq", label: "Groq", fields: [{ env: "GROQ_API_KEY", label: "API key", secret: true, placeholder: "gsk_…" }] },
	{ id: "xai", label: "xAI", fields: [{ env: "XAI_API_KEY", label: "API key", secret: true, placeholder: "xai-…" }] },
	{ id: "deepseek", label: "DeepSeek", fields: [{ env: "DEEPSEEK_API_KEY", label: "API key", secret: true }] },
];

const ALLOWED = new Set(PROVIDERS.flatMap((p) => p.fields.map((f) => f.env)));
const MAX_LENGTH = 4096;

export function credentialsFile(): string {
	return join(process.env.FORGE_HOME ?? join(homedir(), ".forge"), "credentials.json");
}

function readSaved(): Record<string, string> {
	const file = credentialsFile();
	if (!existsSync(file)) return {};
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as { values?: Record<string, unknown> };
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed.values ?? {})) if (ALLOWED.has(k) && typeof v === "string") out[k] = v;
		return out;
	} catch {
		return {};
	}
}

function writeSaved(values: Record<string, string>): void {
	const file = credentialsFile();
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ version: 1, values }, null, "\t")}\n`, { mode: 0o600 });
	try {
		chmodSync(file, 0o600); // tighten an existing file too (best effort on Windows)
	} catch {
		// not supported on this filesystem
	}
}

// The shell environment as it was before saved values were applied, so removing a saved value restores it.
let original: Record<string, string | undefined> | undefined;

/** Copy saved credentials into process.env (children inherit them). Called by harness-core at startup. */
export function applySavedCredentials(): void {
	original ??= Object.fromEntries([...ALLOWED].map((k) => [k, process.env[k]]));
	const saved = readSaved();
	for (const name of ALLOWED) {
		const value = saved[name] ?? original[name];
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
}

export interface FieldStatus extends CredentialField {
	source: "saved" | "environment" | null;
	/** Non-secret values in full; secrets as •••• plus the last 4 characters. */
	preview: string;
}

export interface ProviderStatus extends Omit<ProviderInfo, "fields"> {
	fields: FieldStatus[];
	configured: boolean;
}

function mask(value: string): string {
	return value.length <= 8 ? "••••" : `••••${value.slice(-4)}`;
}

export function credentialStatus(): ProviderStatus[] {
	original ??= Object.fromEntries([...ALLOWED].map((k) => [k, process.env[k]]));
	const saved = readSaved();
	return PROVIDERS.map((p) => {
		const fields = p.fields.map((f) => {
			const value = saved[f.env] ?? original?.[f.env];
			const source = saved[f.env] !== undefined ? "saved" : original?.[f.env] !== undefined ? "environment" : null;
			return { ...f, source, preview: value === undefined ? "" : f.secret ? mask(value) : value } as FieldStatus;
		});
		// The region alone does not make a provider usable; any other value does.
		const configured = fields.some((f) => f.source !== null && f.env !== "AWS_REGION");
		return { id: p.id, label: p.label, note: p.note, fields, configured };
	});
}

/**
 * Save or remove values for one provider. `values[ENV] = string` saves it, `null` removes the saved value
 * (the shell environment's value, if any, applies again). Unknown providers or variables are rejected.
 */
export function updateCredentials(providerId: string, values: Record<string, string | null>): void {
	const provider = PROVIDERS.find((p) => p.id === providerId);
	if (!provider) throw new Error(`Unknown provider "${providerId}"`);
	const allowed = new Set(provider.fields.map((f) => f.env));
	const saved = readSaved();
	for (const [name, value] of Object.entries(values)) {
		if (!allowed.has(name)) throw new Error(`${name} is not a ${provider.label} setting`);
		if (value === null || value.trim() === "") {
			delete saved[name];
			continue;
		}
		const clean = value.trim();
		if (clean.length > MAX_LENGTH || /[\r\n\0]/.test(clean)) throw new Error(`${name} has an invalid value`);
		saved[name] = clean;
	}
	writeSaved(saved);
	applySavedCredentials();
}
