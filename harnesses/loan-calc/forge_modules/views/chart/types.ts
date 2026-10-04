// Copied by forge from templates/views/chart/types.ts. Do not edit here: edit the template and regenerate.
/** Data for the `chart` view. */
export interface ChartData {
	title?: string;
	kind: "bar" | "line";
	/** x-axis labels, one per value in each series */
	labels: string[];
	series: { name: string; values: (number | null)[] }[];
	unit?: string;
}
