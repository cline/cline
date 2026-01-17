export function jsonParseSafe<T>(data: string, defaultValue: T): T {
	try {
		return JSON.parse(data) as T
	} catch {
		return defaultValue
	}
}
