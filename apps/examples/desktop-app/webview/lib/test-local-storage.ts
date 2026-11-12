// Node's built-in localStorage global can shadow jsdom's when no storage file
// is configured, leaving an object without working Storage methods. Install
// an in-memory Storage where both tests and the code under test read it.
export function ensureLocalStorage(): void {
	let current: Storage | undefined;
	try {
		current = window.localStorage;
	} catch {
		current = undefined;
	}
	if (
		current &&
		(["getItem", "setItem", "removeItem", "clear"] as const).every(
			(method) => typeof current?.[method] === "function",
		)
	)
		return;
	const values = new Map<string, string>();
	const storage: Storage = {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => {
			values.delete(key);
		},
		setItem: (key, value) => {
			values.set(key, String(value));
		},
	};
	for (const target of [window, globalThis])
		Object.defineProperty(target, "localStorage", {
			configurable: true,
			value: storage,
		});
}
