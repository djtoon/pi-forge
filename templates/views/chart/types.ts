/** Data for the `chart` view. */
export interface ChartData {
	title?: string;
	kind: "bar" | "line";
	/** x-axis labels, one per value in each series */
	labels: string[];
	series: { name: string; values: (number | null)[] }[];
	unit?: string;
}
