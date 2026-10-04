// Copied by forge from templates/views/molecule/types.ts. Do not edit here: edit the template and regenerate.
/** Data for the `molecule` view. */
export interface MoleculeData {
	cid: number;
	name: string;
	formula: string;
	weight: number;
	smiles: string;
	iupac?: string;
	xlogp?: number;
	tpsa?: number;
	hbondDonors?: number;
	hbondAcceptors?: number;
	rotatableBonds?: number;
	charge?: number;
	heavyAtoms?: number;
	/** MDL molfile (SDF record) with 3D coordinates when available, otherwise 2D. */
	sdf?: string;
	sdfDimensions?: "3d" | "2d";
	imageUrl?: string;
	sourceUrl?: string;
}
