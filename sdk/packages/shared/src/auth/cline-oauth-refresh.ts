export interface ClineOAuthRefreshCredentials {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	email?: string;
	metadata?: Record<string, unknown>;
}

export class ClineOAuthRefreshError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly errorCode?: string,
		public readonly requestId?: string,
	) {
		super(message);
		this.name = "ClineOAuthRefreshError";
	}

	isLikelyInvalidGrant(): boolean {
		if (
			this.errorCode &&
			/invalid_grant|invalid_token|unauthorized/i.test(this.errorCode)
		)
			return true;
		return (
			(this.status === 400 || this.status === 401 || this.status === 403) &&
			/invalid|expired|revoked|unauthorized/i.test(this.message)
		);
	}
}

function parseError(text: string): { code?: string; message?: string } {
	try {
		const json = JSON.parse(text) as Record<string, unknown>;
		const error = json.error;
		return {
			code:
				typeof error === "string"
					? error
					: error &&
							typeof error === "object" &&
							typeof (error as Record<string, unknown>).type === "string"
						? ((error as Record<string, unknown>).type as string)
						: undefined,
			message:
				typeof json.error_description === "string"
					? json.error_description
					: typeof json.message === "string"
						? json.message
						: error &&
								typeof error === "object" &&
								typeof (error as Record<string, unknown>).message === "string"
							? ((error as Record<string, unknown>).message as string)
							: undefined,
		};
	} catch {
		return {};
	}
}

/** Provider-neutral transport for Cline OAuth refresh, shared by Core and Gateway. */
export async function refreshClineOAuthCredentials(
	current: ClineOAuthRefreshCredentials,
	options: {
		apiBaseUrl: string;
		headers?:
			| Record<string, string>
			| (() => Promise<Record<string, string>> | Record<string, string>);
		requestTimeoutMs?: number;
		provider?: string;
	},
): Promise<ClineOAuthRefreshCredentials> {
	const base = options.apiBaseUrl.endsWith("/")
		? options.apiBaseUrl
		: `${options.apiBaseUrl}/`;
	const response = await fetch(new URL("api/v1/auth/refresh", base), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(typeof options.headers === "function"
				? await options.headers()
				: options.headers),
		},
		body: JSON.stringify({
			refreshToken: current.refresh,
			grantType: "refresh_token",
		}),
		signal: AbortSignal.timeout(options.requestTimeoutMs ?? 30_000),
	});
	if (!response.ok) {
		const details = parseError(await response.text().catch(() => ""));
		throw new ClineOAuthRefreshError(
			`Token refresh failed: ${response.status}${details.message ? ` - ${details.message}` : ""}`,
			response.status,
			details.code,
			response.headers.get("x-request-id") ?? undefined,
		);
	}
	const json = (await response.json()) as {
		success?: boolean;
		data?: {
			accessToken?: string;
			refreshToken?: string;
			tokenType?: string;
			expiresAt?: string;
			userInfo?: {
				clineUserId?: string | null;
				email?: string;
				[key: string]: unknown;
			};
		};
	};
	const data = json.data;
	const expires = Date.parse(data?.expiresAt ?? "");
	if (
		!json.success ||
		!data?.accessToken ||
		!data.userInfo ||
		Number.isNaN(expires)
	) {
		throw new ClineOAuthRefreshError("Invalid token refresh response");
	}
	return {
		access: data.accessToken,
		refresh: data.refreshToken ?? current.refresh,
		expires,
		accountId: data.userInfo.clineUserId ?? current.accountId,
		email: data.userInfo.email || current.email,
		metadata: {
			...current.metadata,
			provider: current.metadata?.provider ?? options.provider,
			tokenType: data.tokenType,
			userInfo: data.userInfo,
		},
	};
}
