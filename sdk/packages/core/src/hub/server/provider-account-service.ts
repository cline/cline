import type {
	ClineAccountActionRequest,
	ITelemetryService,
} from "@cline/shared";
import {
	CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT,
	getClineEnvironmentConfig,
} from "@cline/shared";
import { z } from "zod";
import {
	ClineAccountService,
	type ClineAccountUser,
	executeClineAccountAction,
	persistClineAccountTelemetryIdentity,
	resolveClineAccountTelemetryIdentity,
} from "../../account";
import { getProviderAuthHandler } from "../../auth/provider-auth-registry";
import {
	OAuthReauthRequiredError,
	RuntimeOAuthTokenManager,
} from "../../runtime/orchestration/runtime-oauth-token-manager";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import { captureAuthRefreshSoftFailure } from "../../services/telemetry/core-events";

const action = z.literal("clineAccount");
const id = z.string().trim().min(1);
const accountActionSchema = z.discriminatedUnion("operation", [
	z.object({ action, operation: z.literal("fetchMe") }).strict(),
	z
		.object({
			action,
			operation: z.literal("fetchBalance"),
			userId: id.optional(),
		})
		.strict(),
	z
		.object({
			action,
			operation: z.literal("fetchUsageTransactions"),
			userId: id.optional(),
		})
		.strict(),
	z
		.object({
			action,
			operation: z.literal("fetchPaymentTransactions"),
			userId: id.optional(),
		})
		.strict(),
	z.object({ action, operation: z.literal("fetchUserOrganizations") }).strict(),
	z
		.object({
			action,
			operation: z.literal("fetchOrganizationBalance"),
			organizationId: id,
		})
		.strict(),
	z
		.object({
			action,
			operation: z.literal("fetchOrganizationUsageTransactions"),
			organizationId: id,
			memberId: id.optional(),
		})
		.strict(),
	z
		.object({
			action,
			operation: z.literal("switchAccount"),
			organizationId: id.nullable().optional(),
		})
		.strict(),
	z.object({ action, operation: z.literal("fetchFeaturebaseToken") }).strict(),
	z.object({ action, operation: z.literal("fetchCurrentUserPlan") }).strict(),
]);

/** Shared refresh coordinator and account API owner, independent of Desktop viewers. */
export class HubProviderAccountService {
	private readonly manager = new ProviderSettingsManager();
	private readonly tokens: RuntimeOAuthTokenManager;
	constructor(private readonly telemetry?: ITelemetryService) {
		this.tokens = new RuntimeOAuthTokenManager({
			providerSettingsManager: this.manager,
			telemetry,
		});
	}
	async execute(input: ClineAccountActionRequest): Promise<unknown> {
		const request = accountActionSchema.parse(input);
		let token: string | undefined;
		try {
			token = (await this.tokens.resolveProviderApiKey({ providerId: "cline" }))
				?.apiKey;
		} catch (error) {
			if (error instanceof OAuthReauthRequiredError)
				return CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT;
			// Transient refresh failures may still use the persisted access token.
			token = getProviderAuthHandler("cline")?.getApiKey(
				this.manager.getProviderSettings("cline"),
			);
			if (!token) {
				captureAuthRefreshSoftFailure(this.telemetry, "cline", {
					errorName: error instanceof Error ? error.name : "Error",
					errorCode: "hub_account_refresh_failed_no_fallback_token",
				});
				return CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT;
			}
		}
		token ||= getProviderAuthHandler("cline")?.getApiKey(
			this.manager.getProviderSettings("cline"),
		);
		if (!token) return CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT;
		const settings = this.manager.getProviderSettings("cline");
		const identity =
			settings?.auth?.accountId ||
			settings?.auth?.accessToken ||
			settings?.apiKey;
		const authToken = token;
		const service = new ClineAccountService({
			apiBaseUrl:
				settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
			getAuthToken: async () => authToken,
		});
		const result = await executeClineAccountAction(request, service);
		const current = this.manager.getProviderSettings("cline");
		if (
			(current?.auth?.accountId ||
				current?.auth?.accessToken ||
				current?.apiKey) !== identity ||
			current?.baseUrl !== settings?.baseUrl
		) {
			throw new Error("Cline account changed during the request");
		}
		if (request.operation === "fetchMe" && (result as ClineAccountUser)?.id) {
			persistClineAccountTelemetryIdentity(
				this.manager,
				resolveClineAccountTelemetryIdentity(result as ClineAccountUser),
			);
		}
		return result;
	}
}
