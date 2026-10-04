// Copied by forge from templates/views/data-table/types.ts. Do not edit here: edit the template and regenerate.
/** Data for the `data-table` view. */
export interface DataTableData {
	title?: string;
	columns: string[];
	rows: (string | number | null)[][];
	/** Optional: rows can be opened in another view (e.g. "molecule"), keyed by a column. */
	rowLink?: { column: string; view: string };
}
