export function sortTaskItemsByRecency<T extends { ts: number }>(items: T[], oldest = false): T[] {
	return [...items].sort((left, right) => (oldest ? left.ts - right.ts : right.ts - left.ts))
}
