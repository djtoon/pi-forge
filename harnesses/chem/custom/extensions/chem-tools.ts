import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DataTableData } from "../../forge_modules/views/data-table/types.ts";
import type { MoleculeData } from "../../forge_modules/views/molecule/types.ts";
import { viewResult, withViews } from "../../forge_modules/views/registry.ts";
import { lookupMolecule, moleculeProperties, similarMolecules } from "../lib/pubchem.ts";

// Domain tools for the chem harness. They return data only (viewResult); how results look in the
// terminal and the web UI comes from the views listed in harness.yaml.

const READ_ONLY_WEB = { readOnlyHint: true, openWorldHint: true } as const;

function summary(m: MoleculeData): string {
	const parts = [
		`${m.name} (CID ${m.cid}): ${m.formula}, MW ${m.weight} g/mol`,
		`SMILES ${m.smiles}`,
		m.iupac ? `IUPAC ${m.iupac}` : "",
		`XLogP ${m.xlogp ?? "n/a"}, TPSA ${m.tpsa ?? "n/a"}, HBD ${m.hbondDonors ?? "n/a"}, HBA ${m.hbondAcceptors ?? "n/a"}, rotatable bonds ${m.rotatableBonds ?? "n/a"}, charge ${m.charge ?? 0}`,
		m.sdf ? `${m.sdfDimensions} structure loaded (shown to the user in the molecule view)` : "no structure file",
		m.sourceUrl ?? "",
	];
	return parts.filter(Boolean).join("\n");
}

function tableText(table: DataTableData): string {
	return [table.columns.join(" | "), ...table.rows.map((r) => r.map((v) => v ?? "n/a").join(" | "))].join("\n");
}

const callLine = (theme: Theme, label: string, detail: string) =>
	new Text(`${theme.fg("toolTitle", theme.bold(`${label} `))}${theme.fg("muted", detail)}`, 0, 0);

const queryKind = StringEnum(["auto", "name", "smiles", "cid"] as const, {
	description: "How to interpret the query. auto detects CIDs and SMILES, otherwise treats it as a name.",
});

const moleculeLookup = defineTool({
	name: "molecule_lookup",
	label: "Molecule",
	description:
		"Look up one compound in PubChem by name, SMILES, or CID. Returns identity and computed properties, and shows the user an interactive structure view.",
	parameters: Type.Object({
		query: Type.String({ description: "Compound name, SMILES string, or PubChem CID" }),
		kind: Type.Optional(queryKind),
	}),
	annotations: READ_ONLY_WEB,
	async execute(_id, params, signal) {
		const molecule = await lookupMolecule(params.query, params.kind ?? "auto", signal);
		return viewResult(summary(molecule), "molecule", molecule);
	},
	renderCall: (args, theme) => callLine(theme, "molecule", args.query),
});

const moleculeCompare = defineTool({
	name: "molecule_compare",
	label: "Compare",
	description:
		"Compare 2 to 10 compounds side by side (formula, weight, XLogP, TPSA, H-bond donors/acceptors, rotatable bonds). Shows the user a table.",
	parameters: Type.Object({
		queries: Type.Array(Type.String(), { minItems: 2, maxItems: 10, description: "Names, SMILES, or CIDs" }),
	}),
	annotations: READ_ONLY_WEB,
	async execute(_id, params, signal) {
		const settled = await Promise.allSettled(params.queries.map((q) => moleculeProperties(q, "auto", signal)));
		const table: DataTableData = {
			title: "Compared molecules",
			columns: ["Query", "Name", "CID", "Formula", "MW", "XLogP", "TPSA", "HBD", "HBA", "RotB"],
			rows: settled.map((s, i) => {
				const query = params.queries[i] ?? "";
				if (s.status === "rejected") {
					const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
					return [query, `not found: ${reason}`, null, null, null, null, null, null, null, null];
				}
				const m = s.value;
				return [query, m.name, m.cid, m.formula, m.weight, m.xlogp ?? null, m.tpsa ?? null, m.hbondDonors ?? null, m.hbondAcceptors ?? null, m.rotatableBonds ?? null];
			}),
			rowLink: { column: "CID", view: "molecule" },
		};
		return viewResult(tableText(table), "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "compare", args.queries.join(", ")),
});

const similarMoleculesTool = defineTool({
	name: "similar_molecules",
	label: "Similar",
	description: "Find compounds structurally similar to one compound (PubChem 2D Tanimoto similarity). Shows the user a table.",
	parameters: Type.Object({
		query: Type.String({ description: "Compound name, SMILES string, or PubChem CID" }),
		threshold: Type.Optional(Type.Integer({ minimum: 70, maximum: 99, description: "Similarity threshold in percent. Default 90." })),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25, description: "Maximum results. Default 8." })),
	}),
	annotations: READ_ONLY_WEB,
	async execute(_id, params, signal) {
		const base = await moleculeProperties(params.query, "auto", signal);
		const threshold = params.threshold ?? 90;
		const hits = await similarMolecules(base.cid, threshold, params.limit ?? 8, signal);
		const table: DataTableData = {
			title: `Similar to ${base.name} (≥${threshold}%)`,
			columns: ["Name", "CID", "Formula", "MW", "XLogP", "SMILES"],
			rows: hits.map((m) => [m.name, m.cid, m.formula, m.weight, m.xlogp ?? null, m.smiles]),
			rowLink: { column: "CID", view: "molecule" },
		};
		const text = hits.length === 0 ? `No compounds ≥${threshold}% similar to ${base.name}.` : tableText(table);
		return viewResult(text, "data-table", table);
	},
	renderCall: (args, theme) => callLine(theme, "similar", args.query),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(withViews(moleculeLookup));
	pi.registerTool(withViews(moleculeCompare));
	pi.registerTool(withViews(similarMoleculesTool));
}
