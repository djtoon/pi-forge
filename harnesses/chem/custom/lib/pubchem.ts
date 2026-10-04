import type { MoleculeData } from "../../forge_modules/views/molecule/types.ts";

const BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const PROPS = [
	"Title",
	"MolecularFormula",
	"MolecularWeight",
	"SMILES",
	"IUPACName",
	"XLogP",
	"TPSA",
	"HBondDonorCount",
	"HBondAcceptorCount",
	"RotatableBondCount",
	"Charge",
	"HeavyAtomCount",
].join(",");

export type QueryKind = "auto" | "name" | "smiles" | "cid";

interface PropertyRow {
	CID: number;
	Title?: string;
	MolecularFormula: string;
	MolecularWeight: string;
	SMILES: string;
	IUPACName?: string;
	XLogP?: number;
	TPSA?: number;
	HBondDonorCount?: number;
	HBondAcceptorCount?: number;
	RotatableBondCount?: number;
	Charge?: number;
	HeavyAtomCount?: number;
}

export class PubChemError extends Error {}

async function request(path: string, signal?: AbortSignal, body?: URLSearchParams): Promise<Response> {
	const res = await fetch(`${BASE}${path}`, {
		method: body ? "POST" : "GET",
		body,
		signal: signal ?? AbortSignal.timeout(20_000),
	});
	if (res.status === 404) throw new PubChemError("Not found in PubChem");
	if (!res.ok) throw new PubChemError(`PubChem error ${res.status}: ${(await res.text()).slice(0, 200)}`);
	return res;
}

/**
 * SMILES uses only element symbols of the organic subset (plus bracket atoms, bonds, rings).
 * Names almost always contain other letters ("aspirin" has a, i, r), so check the alphabet.
 */
function looksLikeSmiles(query: string): boolean {
	if (/\s/.test(query)) return false;
	const withoutBrackets = query.replace(/\[[^\]]*\]/g, "").replace(/Cl|Br/g, "");
	return /^[BCNOPSFIbcnops0-9()=#@+\-\\/%.*]+$/.test(withoutBrackets);
}

function resolveKind(query: string, kind: QueryKind): Exclude<QueryKind, "auto"> {
	if (kind !== "auto") return kind;
	if (/^\d+$/.test(query)) return "cid";
	return looksLikeSmiles(query) ? "smiles" : "name";
}

async function fetchProperties(query: string, kind: QueryKind, signal?: AbortSignal): Promise<PropertyRow[]> {
	const resolved = resolveKind(query.trim(), kind);
	const res =
		resolved === "smiles"
			? await request(`/compound/smiles/property/${PROPS}/JSON`, signal, new URLSearchParams({ smiles: query }))
			: await request(`/compound/${resolved}/${encodeURIComponent(query.trim())}/property/${PROPS}/JSON`, signal);
	const json = (await res.json()) as { PropertyTable?: { Properties?: PropertyRow[] } };
	const rows = json.PropertyTable?.Properties ?? [];
	if (rows.length === 0 || !rows[0]?.CID) throw new PubChemError(`No compound matches "${query}"`);
	return rows;
}

async function fetchSdf(cid: number, signal?: AbortSignal): Promise<{ sdf?: string; dims?: "3d" | "2d" }> {
	for (const dims of ["3d", "2d"] as const) {
		try {
			const res = await request(`/compound/cid/${cid}/SDF?record_type=${dims}`, signal);
			return { sdf: await res.text(), dims };
		} catch (error) {
			if (!(error instanceof PubChemError)) throw error;
		}
	}
	return {};
}

function toMolecule(row: PropertyRow, fallbackName: string): MoleculeData {
	return {
		cid: row.CID,
		name: row.Title ?? fallbackName,
		formula: row.MolecularFormula,
		weight: Number(row.MolecularWeight),
		smiles: row.SMILES,
		iupac: row.IUPACName,
		xlogp: row.XLogP,
		tpsa: row.TPSA,
		hbondDonors: row.HBondDonorCount,
		hbondAcceptors: row.HBondAcceptorCount,
		rotatableBonds: row.RotatableBondCount,
		charge: row.Charge,
		heavyAtoms: row.HeavyAtomCount,
		imageUrl: `${BASE}/compound/cid/${row.CID}/PNG`,
		sourceUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${row.CID}`,
	};
}

/** Look up one compound by name, SMILES, or CID, including its structure file. */
export async function lookupMolecule(query: string, kind: QueryKind = "auto", signal?: AbortSignal): Promise<MoleculeData> {
	const [row] = await fetchProperties(query, kind, signal);
	if (!row) throw new PubChemError(`No compound matches "${query}"`);
	const molecule = toMolecule(row, query);
	const { sdf, dims } = await fetchSdf(row.CID, signal);
	return { ...molecule, sdf, sdfDimensions: dims };
}

/** Properties only (no structure file); used for tables. */
export async function moleculeProperties(query: string, kind: QueryKind = "auto", signal?: AbortSignal): Promise<MoleculeData> {
	const [row] = await fetchProperties(query, kind, signal);
	if (!row) throw new PubChemError(`No compound matches "${query}"`);
	return toMolecule(row, query);
}

/** 2D (Tanimoto) similarity search around one compound. */
export async function similarMolecules(
	cid: number,
	threshold: number,
	limit: number,
	signal?: AbortSignal,
): Promise<MoleculeData[]> {
	const res = await request(
		`/compound/fastsimilarity_2d/cid/${cid}/property/${PROPS}/JSON?Threshold=${threshold}&MaxRecords=${limit + 1}`,
		signal,
	);
	const json = (await res.json()) as { PropertyTable?: { Properties?: PropertyRow[] } };
	return (json.PropertyTable?.Properties ?? [])
		.filter((row) => row.CID !== cid)
		.slice(0, limit)
		.map((row) => toMolecule(row, `CID ${row.CID}`));
}
