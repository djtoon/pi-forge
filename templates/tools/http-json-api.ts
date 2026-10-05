// Template: a tool that calls an HTTP/JSON API and returns its result as a view.
// Copy to harnesses/<name>/custom/extensions/<topic>-tools.ts, then rename and adapt.
// The relative imports below are correct for that location. Needs the data-table view in ui.views.
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DataTableData } from "../../forge_modules/views/data-table/types.ts";
import { viewResult, withViews } from "../../forge_modules/views/registry.ts";

const BASE_URL = "https://api.example.com/v1"; // TODO: the API base URL
// TODO: the token's variable, declared under `credentials:` in harness.yaml so users can set it in Settings.
// Once it's declared and generated, prefer: import { requireKey } from "../../forge_modules/keys.ts";
const TOKEN_ENV = "EXAMPLE_API_TOKEN";

interface Item {
	id: string;
	name: string;
	status: string;
	updated: string;
}

async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
	const token = process.env[TOKEN_ENV];
	if (!token) throw new Error(`${TOKEN_ENV} is not set. Ask the user to add it in Settings (this harness's keys) or with /keys.`);
	const res = await fetch(`${BASE_URL}${path}`, {
		headers: { authorization: `Bearer ${token}`, accept: "application/json" },
		signal: signal ?? AbortSignal.timeout(20_000),
	});
	if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
	return (await res.json()) as T;
}

const searchItems = defineTool({
	name: "search_items", // TODO: snake_case verb_noun; list it in tools.custom
	label: "Search items",
	description: "Search items by text and status. Use it to find items before acting on them. Shows the user a table.",
	parameters: Type.Object({
		query: Type.String({ description: "Free-text search" }),
		status: Type.Optional(StringEnum(["open", "done", "all"] as const, { description: "Default: all" })),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Default 20" })),
	}),
	annotations: { readOnlyHint: true, openWorldHint: true },
	async execute(_id, params, signal) {
		const q = new URLSearchParams({ q: params.query, status: params.status ?? "all", limit: String(params.limit ?? 20) });
		const items = await api<Item[]>(`/items?${q}`, signal);
		const table: DataTableData = {
			title: `Items matching "${params.query}"`,
			columns: ["Id", "Name", "Status", "Updated"],
			rows: items.map((i) => [i.id, i.name, i.status, i.updated]),
		};
		const text = items.length === 0 ? "No items found." : items.map((i) => `${i.id} | ${i.name} | ${i.status}`).join("\n");
		return viewResult(text, "data-table", table);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(withViews(searchItems));
}
