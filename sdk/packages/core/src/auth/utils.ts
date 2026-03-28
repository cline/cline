import type { OAuthCallbackPayload } from "./server";
import type { OAuthCredentials } from "./types";

function base64UrlEncode(input: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < input.length; i += 1) {
		binary += String.fromCharCode(input[i] ?? 0);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

async function sha256(value: string): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const data = encoder.encode(value);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return new Uint8Array(digest);
}

function createVerifier(byteLength = 32): string {
	const randomBytes = new Uint8Array(byteLength);
	crypto.getRandomValues(randomBytes);
	return base64UrlEncode(randomBytes);
}

export async function getProofKey(): Promise<{
	verifier: string;
	challenge: string;
}> {
	const verifier = createVerifier();
	const challenge = base64UrlEncode(await sha256(verifier));
	return { verifier, challenge };
}

export function normalizeBaseUrl(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function resolveUrl(baseUrl: string, path: string): string {
	return new URL(path, `${normalizeBaseUrl(baseUrl)}/`).toString();
}

export type ParsedAuthorizationInput = {
	code?: string;
	state?: string;
	provider?: string;
};

export type ParseAuthorizationInputOptions = {
	includeProvider?: boolean;
	allowHashCodeState?: boolean;
};

export function parseAuthorizationInput(
	input: string,
	options: ParseAuthorizationInputOptions = {},
): ParsedAuthorizationInput {
	const value = input.trim();
	if (!value) {
		return {};
	}

	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
			provider: options.includeProvider
				? (url.searchParams.get("provider") ?? undefined)
				: undefined,
		};
	} catch {
		// not a URL
	}

	if (options.allowHashCodeState && value.includes("#")) {
		const [code, state] = value.split("#", 2);
		return {
			code: code || undefined,
			state: state || undefined,
		};
	}

	if (value.includes("code=")) {
		const params = new URLSearchParams(value);
		return {
			code: params.get("code") ?? undefined,
			state: params.get("state") ?? undefined,
			provider: options.includeProvider
				? (params.get("provider") ?? undefined)
				: undefined,
		};
	}

	return { code: value };
}

function decodeBase64(value: string): string | null {
	if (typeof atob === "function") {
		try {
			return atob(value);
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
	if (!token) {
		return null;
	}

	try {
		const parts = token.split(".");
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
		const decoded = decodeBase64(padded);
		if (!decoded) {
			return null;
		}
		return JSON.parse(decoded) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function parseOAuthError(text: string): {
	code?: string;
	message?: string;
} {
	try {
		const json = JSON.parse(text) as Record<string, unknown>;
		const error = json.error;
		const code =
			typeof error === "string"
				? error
				: error &&
						typeof error === "object" &&
						typeof (error as Record<string, unknown>).type === "string"
					? ((error as Record<string, unknown>).type as string)
					: undefined;
		const message =
			typeof json.error_description === "string"
				? json.error_description
				: typeof json.message === "string"
					? json.message
					: error &&
							typeof error === "object" &&
							typeof (error as Record<string, unknown>).message === "string"
						? ((error as Record<string, unknown>).message as string)
						: undefined;
		return { code, message };
	} catch {
		return {};
	}
}

export function isCredentialLikelyExpired(
	credentials: Pick<OAuthCredentials, "expires">,
	refreshBufferMs: number,
): boolean {
	return Date.now() >= credentials.expires - refreshBufferMs;
}

export async function resolveAuthorizationCodeInput(input: {
	waitForCallback: () => Promise<OAuthCallbackPayload | null>;
	cancelWait: () => void;
	onManualCodeInput?: () => Promise<string>;
	parseOptions?: ParseAuthorizationInputOptions;
}): Promise<ParsedAuthorizationInput & { error?: string }> {
	if (!input.onManualCodeInput) {
		const callbackResult = await input.waitForCallback();
		return {
			code: callbackResult?.code,
			state: callbackResult?.state,
			provider: callbackResult?.provider,
			error: callbackResult?.error,
		};
	}

	let manualInput: string | undefined;
	let manualError: Error | undefined;
	const manualPromise = input
		.onManualCodeInput()
		.then((value) => {
			manualInput = value;
			input.cancelWait();
		})
		.catch((error: unknown) => {
			manualError = error instanceof Error ? error : new Error(String(error));
			input.cancelWait();
		});

	const callbackResult = await input.waitForCallback();
	if (manualError) {
		throw manualError;
	}

	if (callbackResult?.code || callbackResult?.error) {
		return {
			code: callbackResult.code,
			state: callbackResult.state,
			provider: callbackResult.provider,
			error: callbackResult.error,
		};
	}

	if (manualInput) {
		return parseAuthorizationInput(manualInput, input.parseOptions);
	}

	await manualPromise;
	if (manualError) {
		throw manualError;
	}
	if (manualInput) {
		return parseAuthorizationInput(manualInput, input.parseOptions);
	}

	return {};
}
