function toJsonSafeValue(value: unknown, seen: WeakSet<object>): unknown {
	if (value === null) return null;

	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
		return undefined;
	}
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
	}
	if (!value || typeof value !== "object") {
		return undefined;
	}
	if (seen.has(value)) {
		return "[Circular]";
	}
	seen.add(value);

	if (Array.isArray(value)) {
		return value.map((item) => {
			const next = toJsonSafeValue(item, seen);
			return next === undefined ? null : next;
		});
	}

	const output: Record<string, unknown> = {};
	let keys: (string | symbol)[];
	try {
		keys = Reflect.ownKeys(value);
	} catch {
		return undefined;
	}

	for (const key of keys) {
		if (typeof key !== "string") continue;
		let child: unknown;
		try {
			child = (value as Record<string, unknown>)[key];
		} catch {
			continue;
		}
		const next = toJsonSafeValue(child, seen);
		if (next !== undefined) {
			output[key] = next;
		}
	}

	return output;
}

export function cloneJsonRecord(
	value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const cloned = toJsonSafeValue(value, new WeakSet<object>());
	return cloned && typeof cloned === "object" && !Array.isArray(cloned)
		? (cloned as Record<string, unknown>)
		: undefined;
}

export function stringifyJsonRecord(
	value: Record<string, unknown> | null | undefined,
): string | null {
	const cloned = cloneJsonRecord(value);
	if (!cloned || Object.keys(cloned).length === 0) {
		return null;
	}
	return JSON.stringify(cloned);
}
