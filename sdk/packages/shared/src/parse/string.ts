export function sanitizeFileName(value: string): string {
	return value.toLowerCase().replace(/[^\w.-]+/g, "_");
}
