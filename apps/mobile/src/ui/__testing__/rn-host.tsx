/** Recursively flatten an RN style value (array/object/falsey) to one object. */
export function flattenStyle(style: unknown): Record<string, unknown> {
	if (!style) {
		return {};
	}
	if (Array.isArray(style)) {
		return style.reduce<Record<string, unknown>>(
			(acc, s) => Object.assign(acc, flattenStyle(s)),
			{},
		);
	}
	if (typeof style === "object") {
		return style as Record<string, unknown>;
	}
	return {};
}
