import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessSpec } from "@forge/harness-spec";

/**
 * Credentials, in two stores with the same rules:
 *
 *   model providers  <FORGE_HOME or ~/.forge>/credentials.json         shared by pi-Forge and every harness
 *   harness keys     <FORGE_HOME or ~/.forge>/<name>/credentials.json  one harness's tool keys (from `credentials:` in its spec)
 *
 * Each file holds { values: { ENV_NAME: value } } with owner-only file mode. Every harness copies the values into its
 * process environment at startup (harness-core), which is how pi, the AWS SDK and custom tools read them. A saved value
 * overrides the same variable from the shell environment; removing it brings the shell's value back.
 *
 * Only declared variables can be saved, and secrets never leave this process in full: the web UI only ever receives
 * a masked preview.
 */

export interface CredentialField {
	env: string;
	label: string;
	secret: boolean;
	placeholder?: string;
	optional?: boolean;
}

export interface CredentialGroup {
	/** pi provider id (matches model.provider) or the harness's service id */
	id: string;
	label: string;
	note?: string;
	/** Where to get the key */
	url?: string;
	/** Tools that need it (harness keys) */
	tools?: string[];
	fields: CredentialField[];
}

/** @deprecated use CredentialGroup */
export type ProviderInfo = CredentialGroup;

export const PROVIDERS: CredentialGroup[] = [
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

const MAX_LENGTH = 4096;

export interface FieldStatus extends CredentialField {
	source: "saved" | "environment" | null;
	/** Non-secret values in full; secrets as •••• plus the last 4 characters. */
	preview: string;
}

export interface GroupStatus extends Omit<CredentialGroup, "fields"> {
	fields: FieldStatus[];
	/** Usable: every required field has a value (providers: any key is set). */
	configured: boolean;
}

/** @deprecated use GroupStatus */
export type ProviderStatus = GroupStatus;

function mask(value: string): string {
	return value.length <= 8 ? "••••" : `••••${value.slice(-4)}`;
}

function forgeHome(): string {
	return process.env.FORGE_HOME ?? join(homedir(), ".forge");
}

export class CredentialStore {
	readonly file: string;
	readonly groups: CredentialGroup[];
	private readonly allowed: Set<string>;
	private readonly isConfigured: (fields: FieldStatus[]) => boolean;
	// The shell environment as it was before saved values were applied, so removing a saved value restores it.
	private original: Record<string, string | undefined> | undefined;

	constructor(file: string, groups: CredentialGroup[], isConfigured?: (fields: FieldStatus[]) => boolean) {
		this.file = file;
		this.groups = groups;
		this.allowed = new Set(groups.flatMap((g) => g.fields.map((f) => f.env)));
		this.isConfigured =
			isConfigured ??
			((fields) => {
				const required = fields.filter((f) => !f.optional);
				return required.length > 0 ? required.every((f) => f.source !== null) : fields.some((f) => f.source !== null);
			});
	}

	private captureOriginal(): Record<string, string | undefined> {
		this.original ??= Object.fromEntries([...this.allowed].map((k) => [k, process.env[k]]));
		return this.original;
	}

	private read(): Record<string, string> {
		if (!existsSync(this.file)) return {};
		try {
			const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { values?: Record<string, unknown> };
			const out: Record<string, string> = {};
			for (const [k, v] of Object.entries(parsed.values ?? {})) if (this.allowed.has(k) && typeof v === "string") out[k] = v;
			return out;
		} catch {
			return {};
		}
	}

	private write(values: Record<string, string>): void {
		mkdirSync(join(this.file, ".."), { recursive: true });
		writeFileSync(this.file, `${JSON.stringify({ version: 1, values }, null, "\t")}\n`, { mode: 0o600 });
		try {
			chmodSync(this.file, 0o600); // tighten an existing file too (best effort on Windows)
		} catch {
			// not supported on this filesystem
		}
	}

	/** Copy saved values into process.env (children inherit them). */
	apply(): void {
		const original = this.captureOriginal();
		const saved = this.read();
		for (const name of this.allowed) {
			const value = saved[name] ?? original[name];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}

	status(): GroupStatus[] {
		const original = this.captureOriginal();
		const saved = this.read();
		return this.groups.map((g) => {
			const fields = g.fields.map((f) => {
				const value = saved[f.env] ?? original[f.env];
				const source = saved[f.env] !== undefined ? "saved" : original[f.env] !== undefined ? "environment" : null;
				return { ...f, source, preview: value === undefined ? "" : f.secret ? mask(value) : value } as FieldStatus;
			});
			const { fields: _declared, ...info } = g;
			return { ...info, fields, configured: this.isConfigured(fields) };
		});
	}

	/**
	 * Save or remove values for one group. `values[ENV] = string` saves it, `null` removes the saved value
	 * (the shell environment's value, if any, applies again). Unknown groups or variables are rejected.
	 */
	update(groupId: string, values: Record<string, string | null>): void {
		const group = this.groups.find((g) => g.id === groupId);
		if (!group) throw new Error(`Unknown service "${groupId}"`);
		const allowed = new Set(group.fields.map((f) => f.env));
		const saved = this.read();
		for (const [name, value] of Object.entries(values)) {
			if (!allowed.has(name)) throw new Error(`${name} is not a ${group.label} setting`);
			if (value === null || (typeof value === "string" && value.trim() === "")) {
				delete saved[name];
				continue;
			}
			if (typeof value !== "string") throw new Error(`${name} must be text`);
			const clean = value.trim();
			if (clean.length > MAX_LENGTH || /[\r\n\0]/.test(clean)) throw new Error(`${name} has an invalid value`);
			saved[name] = clean;
		}
		this.write(saved);
		this.apply();
	}
}

// --- Model providers (shared) ----------------------------------------------------------------------------------------

export function credentialsFile(): string {
	return join(forgeHome(), "credentials.json");
}

let providerStore: CredentialStore | undefined;
function providers(): CredentialStore {
	// The region alone does not make a provider usable; any other value does.
	providerStore ??= new CredentialStore(credentialsFile(), PROVIDERS, (fields) => fields.some((f) => f.source !== null && f.env !== "AWS_REGION"));
	return providerStore;
}

/** Copy saved provider keys into process.env. Called by harness-core at startup. */
export function applySavedCredentials(): void {
	providers().apply();
}

export function credentialStatus(): GroupStatus[] {
	return providers().status();
}

export function updateCredentials(providerId: string, values: Record<string, string | null>): void {
	providers().update(providerId, values);
}

// --- Harness keys (one harness's tools) -------------------------------------------------------------------------------

export function harnessCredentialsFile(name: string): string {
	return join(forgeHome(), name, "credentials.json");
}

const harnessStores = new Map<string, CredentialStore>();

/** The store for a harness's `credentials:` (empty when the spec declares none). */
export function harnessCredentials(spec: HarnessSpec): CredentialStore {
	let store = harnessStores.get(spec.name);
	if (!store) {
		const groups: CredentialGroup[] = (spec.credentials ?? []).map((g) => ({
			id: g.id,
			label: g.label,
			note: g.note,
			url: g.url,
			tools: g.tools,
			fields: g.fields.map((f) => ({ env: f.env, label: f.label, secret: f.secret !== false, placeholder: f.placeholder, optional: f.optional })),
		}));
		store = new CredentialStore(harnessCredentialsFile(spec.name), groups);
		harnessStores.set(spec.name, store);
	}
	return store;
}
