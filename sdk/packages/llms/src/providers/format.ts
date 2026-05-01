export function extractErrorMessage(error: unknown): string {
	const extractStructuredMessage = (value: unknown): string | undefined => {
		if (!value) {
			return undefined;
		}
		if (typeof value === "string") {
			try {
				return extractStructuredMessage(JSON.parse(value));
			} catch {
				return value.trim() || undefined;
			}
		}
		if (typeof value !== "object") {
			return undefined;
		}
		const payload = value as {
			error?: { message?: string } | string;
			errors?: unknown;
			detail?: string;
			message?: string;
			responseBody?: unknown;
			cause?: unknown;
		};
		if (typeof payload.error === "string" && payload.error.trim()) {
			return payload.error;
		}
		if (
			payload.error &&
			typeof payload.error === "object" &&
			typeof payload.error.message === "string" &&
			payload.error.message.trim()
		) {
			return payload.error.message;
		}
		if (typeof payload.detail === "string" && payload.detail.trim()) {
			return payload.detail;
		}
		if (Array.isArray(payload.errors)) {
			for (const error of payload.errors) {
				const nested = extractStructuredMessage(error);
				if (nested) {
					return nested;
				}
			}
		}
		if ("responseBody" in payload && payload.responseBody !== value) {
			const nested = extractStructuredMessage(payload.responseBody);
			if (nested) {
				return nested;
			}
		}
		if ("cause" in payload && payload.cause !== value) {
			const nested = extractStructuredMessage(payload.cause);
			if (nested) {
				return nested;
			}
		}
		if (typeof payload.message === "string" && payload.message.trim()) {
			return payload.message;
		}
		return undefined;
	};

	const structuredMessage = extractStructuredMessage(error);
	if (structuredMessage) {
		return structuredMessage;
	}

	return String(error);
}
