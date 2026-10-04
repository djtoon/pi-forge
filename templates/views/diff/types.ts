/** Data for the `diff` view. */
export interface DiffData {
	title?: string;
	files: { path: string; patch: string }[];
}
