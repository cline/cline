import {
	ProviderSettingsManager,
	identifyAccount,
	clearAccountTelemetryIdentity,
} from "@cline/core";
import { resolveDesktopTelemetryUser } from "./client-context";
import { identifyDesktopFeatureFlagsAccount } from "./feature-flags";
import { resetCloudSessionManager } from "./cloud-sessions";
import type { SidecarContext } from "./types";
export async function observeAccountChange(
	ctx: SidecarContext,
	payload: Record<string, unknown>,
) {
	const auth = new ProviderSettingsManager().getProviderSettings("cline")?.auth;
	if (payload.signedOut || !auth?.accountId) {
		ctx.telemetryUser = resolveDesktopTelemetryUser();
		clearAccountTelemetryIdentity(ctx.telemetry, ctx.telemetryUser.distinctId);
		await identifyDesktopFeatureFlagsAccount(
			{},
			{ logger: ctx.logger, telemetry: ctx.telemetry },
		);
	} else {
		const identity = {
			id: auth.accountId,
			email: auth.email,
			provider: "cline" as const,
			organizationId: auth.organizationId,
			organizationName: auth.organizationName,
			memberId: auth.memberId,
		};
		ctx.telemetryUser = resolveDesktopTelemetryUser({
			accountId: identity.id,
			email: identity.email,
			organizationId: identity.organizationId,
		});
		identifyAccount(ctx.telemetry, identity);
		await identifyDesktopFeatureFlagsAccount(
			{ id: identity.id, email: identity.email },
			{ logger: ctx.logger, telemetry: ctx.telemetry },
		);
	}
	if (payload.credentialsChanged) await resetCloudSessionManager(ctx);
}
