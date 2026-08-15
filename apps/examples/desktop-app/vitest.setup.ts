// Node 25 exposes an empty localStorage object when no backing file is set.
// jsdom can inherit that object instead of installing its Storage instance,
// so provide the browser contract tests expect when the native methods are
// unavailable.
if (
	typeof window !== "undefined" &&
	typeof window.localStorage?.getItem !== "function"
) {
	const values = new Map<string, string>();
	const storage: Storage = {
		get length() {
			return values.size;
		},
		clear() {
			values.clear();
		},
		getItem(key) {
			return values.get(String(key)) ?? null;
		},
		key(index) {
			return [...values.keys()][index] ?? null;
		},
		removeItem(key) {
			values.delete(String(key));
		},
		setItem(key, value) {
			values.set(String(key), String(value));
		},
	};
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: storage,
	});
}
