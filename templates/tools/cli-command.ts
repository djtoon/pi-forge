// Template: a tool that runs a command-line program with structured arguments.
// Copy to harnesses/<name>/custom/extensions/<topic>-tools.ts, then rename and adapt.
// Prefer this over letting the model build raw bash strings: arguments are validated and never shell-interpreted.
// Needs the markdown-doc view in ui.views (or return another view).
import { spawn } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MarkdownDocData } from "../../forge_modules/views/markdown-doc/types.ts";
import { viewResult, withViews } from "../../forge_modules/views/registry.ts";

const PROGRAM = "git"; // TODO: the program to run (must be on PATH)
const MAX_OUTPUT = 40_000;

function run(args: string[], cwd: string, signal?: AbortSignal): Promise<{ code: number; out: string }> {
	return new Promise((resolveRun, reject) => {
		const child = spawn(PROGRAM, args, { cwd, signal, shell: false });
		let out = "";
		const take = (d: Buffer) => {
			if (out.length < MAX_OUTPUT) out += d.toString("utf8");
		};
		child.stdout.on("data", take);
		child.stderr.on("data", take);
		child.on("error", (error) => reject(new Error(`${PROGRAM} failed to start: ${error.message}`)));
		child.on("close", (code) => resolveRun({ code: code ?? -1, out: out.length >= MAX_OUTPUT ? `${out}\n[output truncated]` : out }));
	});
}

const recentChanges = defineTool({
	name: "recent_changes", // TODO: snake_case verb_noun; list it in tools.custom
	label: "Recent changes",
	description: "Show the recent commit history of the current repository as a readable document.",
	parameters: Type.Object({
		count: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Number of commits. Default 15." })),
	}),
	annotations: { readOnlyHint: true },
	async execute(_id, params, signal, _onUpdate, ctx) {
		const { code, out } = await run(["log", `-${params.count ?? 15}`, "--date=short", "--pretty=format:- %ad **%s** (%an)"], ctx.cwd, signal);
		if (code !== 0) throw new Error(out.trim() || `${PROGRAM} exited with ${code}`);
		const doc: MarkdownDocData = { title: "Recent changes", markdown: `# Recent changes\n\n${out}` };
		return viewResult(out, "markdown-doc", doc);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(withViews(recentChanges));
}
