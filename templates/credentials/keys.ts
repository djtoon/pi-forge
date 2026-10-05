import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Keys and settings the harness's tools need (`credentials:` in harness.yaml).
 *
 * Users set them in the browser (Settings → <title> keys), with /keys in the terminal, or as environment variables.
 * Saved values live in ~/.forge/<name>/credentials.json (owner-only) and are copied into process.env when the harness
 * starts, so tools just read process.env, or better, requireKey("NAME") for a clear message when one is missing.
 */
export interface KeyInfo {
	env: string;
	label: string;
	service: string;
	secret: boolean;
	optional?: boolean;
}

export interface KeysConfig {
	name: string;
	title: string;
	keys: KeyInfo[];
}

export class MissingKeyError extends Error {}

function storeFile(name: string): string {
	return join(process.env.FORGE_HOME ?? join(homedir(), ".forge"), name, "credentials.json");
}

function readValues(file: string): Record<string, string> {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as { values?: Record<string, unknown> };
		return Object.fromEntries(Object.entries(parsed.values ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"));
	} catch {
		return {};
	}
}

export function createKeys(config: KeysConfig) {
	const byEnv = new Map(config.keys.map((k) => [k.env, k]));
	const where = (k: KeyInfo) =>
		`Settings → ${config.title} keys → ${k.service} in the browser, /keys in the terminal, or the ${k.env} environment variable`;

	/** The value, or undefined when it is not set. */
	const get = (env: string): string | undefined => process.env[env]?.trim() || undefined;

	/** The value; throws a message the agent can pass on when it is not set. */
	const require = (env: string): string => {
		const value = get(env);
		if (value) return value;
		const k = byEnv.get(env);
		throw new MissingKeyError(
			k
				? `The ${k.label} for ${k.service} is not set (${env}). Ask the user to add it: ${where(k)}. Never ask them to paste it into the chat.`
				: `${env} is not set.`,
		);
	};

	/** Required keys that have no value yet. */
	const missing = (): KeyInfo[] => config.keys.filter((k) => !k.optional && !get(k.env));

	/** Saves a value (or removes it with "") and applies it to this process right away. */
	const save = (env: string, value: string) => {
		const file = storeFile(config.name);
		const values = existsSync(file) ? readValues(file) : {};
		if (value.trim()) values[env] = value.trim();
		else delete values[env];
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, `${JSON.stringify({ version: 1, values }, null, "\t")}\n`, { mode: 0o600 });
		try {
			chmodSync(file, 0o600);
		} catch {
			// best effort on Windows
		}
		if (value.trim()) process.env[env] = value.trim();
		else delete process.env[env];
	};

	/** The /keys command: see which keys are set, and set them, from any UI (terminal or browser dialogs). */
	const extension = (pi: ExtensionAPI) => {
		pi.registerCommand("keys", {
			description: `Set the keys and settings ${config.title}'s tools need`,
			handler: async (_args, ctx) => {
				if (!ctx.hasUI) return;
				for (;;) {
					const rows = config.keys.map((k) => {
						const value = get(k.env);
						const state = value ? (k.secret ? "set" : value) : k.optional ? "optional" : "missing";
						return `${k.service} · ${k.label}  [${state}]`;
					});
					const choice = await ctx.ui.select(`${config.title} keys (saved on this computer only)`, [...rows, "Done"]);
					if (choice === undefined || choice === "Done") return;
					const k = config.keys[rows.indexOf(choice)];
					if (!k) return;
					const typed = await ctx.ui.input(`${k.service} · ${k.label}`, `${k.env}: paste the value, or leave empty to remove it`);
					if (typed === undefined) continue;
					save(k.env, typed);
					ctx.ui.notify(typed.trim() ? `${k.service} · ${k.label} saved.` : `${k.service} · ${k.label} removed.`, "info");
				}
			},
		});
	};

	return { get, require, missing, save, extension };
}
