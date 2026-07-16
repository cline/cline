function decodeBase64Utf8(value: string): string | null {
	if (typeof globalThis.atob === "function") {
		try {
			const binary = globalThis.atob(value);
			const bytes = Uint8Array.from(binary, (character) =>
				character.charCodeAt(0),
			);
			return new TextDecoder().decode(bytes);
		} catch {
			return null;
		}
	}

	if (typeof Buffer !== "undefined") {
		try {
			return Buffer.from(value, "base64").toString("utf8");
		} catch {
			return null;
		}
	}

	return null;
}

export function decodeJwtPayload(
	token?: string,
): Record<string, unknown> | null {
	const trimmed = token?.trim();
	if (!trimmed) {
		return null;
	}

	try {
		const parts = trimmed.split(".");
		if (parts.length !== 3) {
			return null;
		}

		const payload = parts[1];
		if (!payload) {
			return null;
		}

		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(
			normalized.length + ((4 - (normalized.length % 4)) % 4),
			"=",
		);
		const decoded = decodeBase64Utf8(padded);
		return decoded ? (JSON.parse(decoded) as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
