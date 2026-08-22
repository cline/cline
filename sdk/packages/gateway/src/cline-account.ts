import {
	ClineOAuthRefreshError,
	getClineEnvironmentConfig,
} from "@cline/shared";
import {
	readSavedProviderSelection,
	resolveSavedClineOAuthApiKey,
	savedProviderApiKey,
} from "./provider-settings";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export const CLINE_ACCOUNT_NOT_AUTHENTICATED_CODE =
	"ACCOUNT_NOT_AUTHENTICATED" as const;

export interface ClineAccountNotAuthenticatedResult {
	readonly signedIn: false;
	readonly code: typeof CLINE_ACCOUNT_NOT_AUTHENTICATED_CODE;
}

export const CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT: ClineAccountNotAuthenticatedResult =
	Object.freeze({
		signedIn: false,
		code: CLINE_ACCOUNT_NOT_AUTHENTICATED_CODE,
	});

export interface GatewayClineAccountOrganization {
	readonly active: boolean;
	readonly memberId: string;
	readonly name: string;
	readonly organizationId: string;
	readonly roles: readonly ("admin" | "member" | "owner")[];
}

export interface GatewayClineAccountUser {
	readonly id: string;
	readonly email: string;
	readonly displayName: string;
	readonly photoUrl: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly organizations: readonly GatewayClineAccountOrganization[];
}

export interface GatewayClineAccountBalance {
	readonly balance: number;
	readonly userId: string;
}

export interface GatewayClineOrganizationBalance {
	readonly balance: number;
	readonly organizationId: string;
}

export interface GatewayClineUsageTransaction {
	readonly id: string;
	readonly createdAt: string;
	readonly userId: string;
	readonly organizationId: string;
	readonly aiInferenceProviderName: string;
	readonly aiModelName: string;
	readonly aiModelTypeName: string;
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly totalTokens: number;
	readonly costUsd: number;
	readonly creditsUsed: number;
	readonly generationId: string;
	readonly operation?: string;
	readonly metadata: Readonly<Record<string, string>>;
}

export interface GatewayClineOrganizationUsageTransaction
	extends GatewayClineUsageTransaction {
	readonly memberDisplayName: string;
	readonly memberEmail: string;
}

export interface GatewayClinePaymentTransaction {
	readonly paidAt: string;
	readonly creatorId: string;
	readonly amountCents: number;
	readonly credits: number;
}

export type GatewayClineAccountQuery =
	| { readonly operation: "fetchMe" }
	| { readonly operation: "fetchBalance"; readonly userId?: string }
	| {
			readonly operation: "fetchUsageTransactions";
			readonly userId?: string;
	  }
	| {
			readonly operation: "fetchPaymentTransactions";
			readonly userId?: string;
	  }
	| { readonly operation: "fetchUserOrganizations" }
	| {
			readonly operation: "fetchOrganizationBalance";
			readonly organizationId: string;
	  }
	| {
			readonly operation: "fetchOrganizationUsageTransactions";
			readonly organizationId: string;
			readonly memberId?: string;
	  };

export type GatewayClineAccountQueryResult<T extends GatewayClineAccountQuery> =
	| ClineAccountNotAuthenticatedResult
	| (T["operation"] extends "fetchMe"
			? GatewayClineAccountUser
			: T["operation"] extends "fetchBalance"
				? GatewayClineAccountBalance
				: T["operation"] extends "fetchUsageTransactions"
					? readonly GatewayClineUsageTransaction[]
					: T["operation"] extends "fetchPaymentTransactions"
						? readonly GatewayClinePaymentTransaction[]
						: T["operation"] extends "fetchUserOrganizations"
							? readonly GatewayClineAccountOrganization[]
							: T["operation"] extends "fetchOrganizationBalance"
								? GatewayClineOrganizationBalance
								: readonly GatewayClineOrganizationUsageTransaction[]);

export interface GatewayClineAccountSwitch {
	readonly operation: "switchAccount";
	readonly organizationId?: string | null;
}

export type GatewayClineAccountSwitchResult =
	| ClineAccountNotAuthenticatedResult
	| { readonly switched: true };

export interface GatewayClineAccountPort {
	query<T extends GatewayClineAccountQuery>(
		input: T,
	): Promise<GatewayClineAccountQueryResult<T>>;
	switchAccount(
		input: GatewayClineAccountSwitch,
	): Promise<GatewayClineAccountSwitchResult>;
}

export interface GatewayClineAccountServiceOptions {
	readonly providerSettingsPath: string;
	readonly fetchImpl?: typeof fetch;
	readonly requestTimeoutMs?: number;
	readonly env?: Record<string, string | undefined>;
	readonly resolveOAuthToken?: typeof resolveSavedClineOAuthApiKey;
}

interface AccountCredential {
	readonly token: string;
	readonly apiBaseUrl: string;
}

interface ClineApiEnvelope<T> {
	readonly success?: boolean;
	readonly error?: string;
	readonly data?: T;
}

function envelopeError(parsed: unknown): string | undefined {
	if (!parsed || typeof parsed !== "object" || !("error" in parsed)) {
		return undefined;
	}
	const error = (parsed as { error?: unknown }).error;
	return typeof error === "string" && error.trim() ? error.trim() : undefined;
}

function requestFailure(status: number, body: string, parsed: unknown): string {
	const fromEnvelope = envelopeError(parsed);
	if (fromEnvelope) return fromEnvelope;
	const trimmed = body.trim();
	if (!trimmed) return `Cline account request failed with status ${status}`;
	const preview =
		trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
	return `Cline account request failed with status ${status}: ${preview}`;
}

function required(value: string | undefined, label: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${label} is required`);
	return normalized;
}

/** Cline account API authority. Provider credentials never leave this class. */
export class GatewayClineAccountService implements GatewayClineAccountPort {
	private readonly providerSettingsPath: string;
	private readonly fetchImpl: typeof fetch;
	private readonly requestTimeoutMs: number;
	private readonly env: Record<string, string | undefined>;
	private readonly resolveOAuthToken: typeof resolveSavedClineOAuthApiKey;

	constructor(options: GatewayClineAccountServiceOptions) {
		this.providerSettingsPath = options.providerSettingsPath;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.env = options.env ?? process.env;
		this.resolveOAuthToken =
			options.resolveOAuthToken ?? resolveSavedClineOAuthApiKey;
	}

	async query<T extends GatewayClineAccountQuery>(
		input: T,
	): Promise<GatewayClineAccountQueryResult<T>> {
		const credential = await this.credential();
		if (!credential) return CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT;

		let result: unknown;
		switch (input.operation) {
			case "fetchMe":
				result = await this.request<GatewayClineAccountUser>(
					credential,
					"/api/v1/users/me",
				);
				break;
			case "fetchBalance": {
				const userId = await this.resolveUserId(credential, input.userId);
				result = await this.request<GatewayClineAccountBalance>(
					credential,
					`/api/v1/users/${encodeURIComponent(userId)}/balance`,
				);
				break;
			}
			case "fetchUsageTransactions": {
				const userId = await this.resolveUserId(credential, input.userId);
				const response = await this.request<{
					items?: GatewayClineUsageTransaction[];
				}>(credential, `/api/v1/users/${encodeURIComponent(userId)}/usages`);
				result = response.items ?? [];
				break;
			}
			case "fetchPaymentTransactions": {
				const userId = await this.resolveUserId(credential, input.userId);
				const response = await this.request<{
					paymentTransactions?: GatewayClinePaymentTransaction[];
				}>(credential, `/api/v1/users/${encodeURIComponent(userId)}/payments`);
				result = response.paymentTransactions ?? [];
				break;
			}
			case "fetchUserOrganizations": {
				const me = await this.request<GatewayClineAccountUser>(
					credential,
					"/api/v1/users/me",
				);
				result = me.organizations ?? [];
				break;
			}
			case "fetchOrganizationBalance": {
				const organizationId = required(input.organizationId, "organizationId");
				result = await this.request<GatewayClineOrganizationBalance>(
					credential,
					`/api/v1/organizations/${encodeURIComponent(organizationId)}/balance`,
				);
				break;
			}
			case "fetchOrganizationUsageTransactions": {
				const organizationId = required(input.organizationId, "organizationId");
				const memberId = await this.resolveMemberId(
					credential,
					organizationId,
					input.memberId,
				);
				const response = await this.request<{
					items?: GatewayClineOrganizationUsageTransaction[];
				}>(
					credential,
					`/api/v1/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}/usages`,
				);
				result = response.items ?? [];
				break;
			}
		}
		return result as GatewayClineAccountQueryResult<T>;
	}

	async switchAccount(
		input: GatewayClineAccountSwitch,
	): Promise<GatewayClineAccountSwitchResult> {
		const credential = await this.credential();
		if (!credential) return CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT;
		await this.request<void>(credential, "/api/v1/users/active-account", {
			method: "PUT",
			body: { organizationId: input.organizationId?.trim() || null },
			expectNoContent: true,
		});
		return { switched: true };
	}

	private async credential(): Promise<AccountCredential | undefined> {
		const selection = readSavedProviderSelection("cline", {
			filePath: this.providerSettingsPath,
			env: this.env,
		});
		if (!selection) return undefined;
		const fallback = savedProviderApiKey("cline", selection.settings);
		if (!fallback) return undefined;

		let token: string | undefined;
		try {
			token = await this.resolveOAuthToken("cline", {
				filePath: this.providerSettingsPath,
				env: this.env,
			});
		} catch (error) {
			if (
				error instanceof ClineOAuthRefreshError &&
				error.isLikelyInvalidGrant()
			) {
				throw new Error(
					"The Cline account credential is no longer valid and requires re-authentication. Sign in again from Settings > Account.",
					{ cause: error },
				);
			}
			throw new Error(
				`Cline account authentication could not be refreshed: ${error instanceof Error ? error.message : String(error)}. Check your connection and retry.`,
				{ cause: error },
			);
		}

		return {
			token: token ?? fallback,
			apiBaseUrl:
				selection.settings.baseUrl?.trim() ||
				getClineEnvironmentConfig().apiBaseUrl,
		};
	}

	private async resolveUserId(
		credential: AccountCredential,
		userId?: string,
	): Promise<string> {
		const explicit = userId?.trim();
		if (explicit) return explicit;
		const me = await this.request<GatewayClineAccountUser>(
			credential,
			"/api/v1/users/me",
		);
		return required(me.id, "current Cline user id");
	}

	private async resolveMemberId(
		credential: AccountCredential,
		organizationId: string,
		memberId?: string,
	): Promise<string> {
		const explicit = memberId?.trim();
		if (explicit) return explicit;
		const me = await this.request<GatewayClineAccountUser>(
			credential,
			"/api/v1/users/me",
		);
		const resolved = me.organizations?.find(
			(organization) => organization.organizationId === organizationId,
		)?.memberId;
		if (!resolved?.trim()) {
			throw new Error(
				`Unable to resolve the current member for Cline organization ${organizationId}. Refresh the account view and retry.`,
			);
		}
		return resolved;
	}

	private async request<T>(
		credential: AccountCredential,
		endpoint: string,
		input: {
			readonly method?: "GET" | "PUT";
			readonly body?: unknown;
			readonly expectNoContent?: boolean;
		} = {},
	): Promise<T> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
		try {
			const response = await this.fetchImpl(
				new URL(endpoint, withTrailingSlash(credential.apiBaseUrl)),
				{
					method: input.method ?? "GET",
					headers: {
						Authorization: `Bearer ${credential.token}`,
						"Content-Type": "application/json",
					},
					body:
						input.body === undefined ? undefined : JSON.stringify(input.body),
					signal: controller.signal,
				},
			);
			if (response.status === 204 || input.expectNoContent) {
				if (!response.ok) {
					throw new Error(
						`Cline account request failed with status ${response.status}`,
					);
				}
				return undefined as T;
			}

			const body = await response.text();
			let parsed: unknown;
			if (body.trim()) {
				try {
					parsed = JSON.parse(body);
				} catch {
					if (!response.ok) {
						throw new Error(requestFailure(response.status, body, undefined));
					}
					throw new Error("Cline account response was not valid JSON");
				}
			}
			if (!response.ok) {
				throw new Error(requestFailure(response.status, body, parsed));
			}
			if (parsed && typeof parsed === "object") {
				const envelope = parsed as ClineApiEnvelope<T>;
				if (typeof envelope.success === "boolean") {
					if (!envelope.success) {
						throw new Error(envelope.error || "Cline account request failed");
					}
					return envelope.data as T;
				}
			}
			if (parsed === undefined || parsed === null) {
				throw new Error("Cline account response payload was empty");
			}
			return parsed as T;
		} catch (error) {
			if (controller.signal.aborted) {
				throw new Error(
					"Cline account request timed out. Check your connection and retry.",
					{ cause: error },
				);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}
}

function withTrailingSlash(value: string): string {
	return value.endsWith("/") ? value : `${value}/`;
}
