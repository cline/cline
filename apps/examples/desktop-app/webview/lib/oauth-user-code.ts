let code: string | null = null;
const listeners = new Set<() => void>();
export function setOAuthUserCode(value: string | null) {
	code = value;
	for (const listener of listeners) listener();
}
export function subscribeOAuthUserCode(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
export function getOAuthUserCode() {
	return code;
}
