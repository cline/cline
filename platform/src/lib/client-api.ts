export class ApiClientError extends Error {
	readonly code: string;
	readonly status: number;
	readonly details?: unknown;

	constructor(status: number, code: string, message: string, details?: unknown) {
		super(message);
		this.name = "ApiClientError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

type ApiEnvelope<T> =
	| { ok: true; data: T }
	| { ok: false; error: { code: string; message: string } };

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	let response: Response;
	try {
		response = await fetch(path, {
			...init,
			headers: {
				...(init?.body ? { "Content-Type": "application/json" } : {}),
				...init?.headers,
			},
			cache: "no-store",
		});
	} catch {
		throw new ApiClientError(0, "network_error", "Network request failed. Check your connection.");
	}

	const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
	if (!response.ok || !payload || payload.ok === false) {
		const error = payload && payload.ok === false ? payload.error : null;
		throw new ApiClientError(
			response.status,
			error?.code ?? "request_failed",
			error?.message ?? `Request failed with status ${response.status}.`,
		);
	}
	return payload.data;
}
