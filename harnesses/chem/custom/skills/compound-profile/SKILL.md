---
name: compound-profile
description: Write a one-page profile of a chemical compound (identity, structure, key properties, drug-likeness, safety notes, close analogs). Use when the user asks to profile, summarize, or "tell me everything about" a molecule, or wants a compound fact sheet.
---

# Compound profile

Build the profile from PubChem data, never from memory. Every number in the profile must come from a tool result.

## Steps
1. **Identify it.** Call `molecule_lookup` with the name, SMILES or CID the user gave. If the name is ambiguous
   (a mixture, a salt vs. free base, a brand name), say which record you used (CID and IUPAC name) and why.
2. **Read the structure.** From the result: formula, molecular weight, SMILES, and the 3D view. Name the main
   functional groups and ring systems you can see in the SMILES.
3. **Drug-likeness.** Check Lipinski's rule of five against the returned properties:
   - molecular weight ≤ 500 Da
   - XLogP ≤ 5
   - hydrogen-bond donors ≤ 5
   - hydrogen-bond acceptors ≤ 10

   Report each as pass/fail with the value. One violation is common for approved oral drugs, and two or more is a flag.
   Also report TPSA. Above 140 Å² suggests poor oral absorption, and below 90 Å² is typical for brain-penetrant compounds.
4. **Analogs.** Call `similar_molecules` (threshold 90 by default; lower to 80 if fewer than 3 come back). Then call
   `molecule_compare` on the compound plus the 2-3 most relevant analogs, and say what the property differences mean.
5. **Safety.** Only state hazards the data supports. If you have no hazard data, say "check the PubChem safety
   section (GHS) before handling" rather than guessing.

## The profile
- **Identity:** name, CID, formula, MW, SMILES
- **Structure:** groups, rings, and stereocenters if any
- **Properties:** XLogP, TPSA, H-bond donors and acceptors, rotatable bonds
- **Drug-likeness:** the Lipinski table and a TPSA note
- **Analogs:** the comparison and its takeaway
- **Notes:** caveats, and which record was used

Keep it to one screen. The molecule and table views already show the raw data, so don't repeat it in full.
