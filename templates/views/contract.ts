/**
 * The view contract. A tool that wants its result shown as a domain view returns
 * `details: { view: "<view id>", data }`. The model only reads `content`; terminal renderers,
 * the JSON/RPC event stream, and the web UI all read `details`.
 */

export interface ViewDetails<T = unknown> {
	view: string;
	data: T;
}

export interface ViewToolResult<T = unknown> {
	content: { type: "text"; text: string }[];
	details: ViewDetails<T>;
}

export function viewResult<T>(text: string, view: string, data: T): ViewToolResult<T> {
	return { content: [{ type: "text", text }], details: { view, data } };
}

export function isViewDetails(value: unknown): value is ViewDetails {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { view?: unknown }).view === "string" &&
		"data" in value
	);
}
