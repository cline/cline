import {
	completeClineDeviceAuth,
	type ITelemetryService,
	isOAuthProvider,
	loginLocalProvider,
	type ProviderSettingsManager,
	saveLocalProviderOAuthCredentials,
	startClineDeviceAuth,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import open from "open";
import { identifyFeatureFlagsAccount } from "../../../utils/feature-flags";

export type OnboardingOAuthProviderId = string;

export function isOnboardingOAuthProviderId(
	providerId: string,
): providerId is OnboardingOAuthProviderId {
	return isOAuthProvider(providerId);
}

function isClineAccountOAuthProvider(providerId: string): boolean {
	return providerId === "cline" || providerId === "cline-pass";
}

export function runOAuthAuthFlow(input: {
	providerId: OnboardingOAuthProviderId;
	providerSettingsManager: ProviderSettingsManager;
	isAborted: () => boolean;
	setStatus: (status: string) => void;
	setAuthUrl: (url: string) => void;
	setError: (error: string) => void;
	onComplete: (providerId: OnboardingOAuthProviderId) => void;
	telemetry?: ITelemetryService;
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);

	loginLocalProvider(
		input.providerId,
		existing,
		(url: string) => {
			input.setAuthUrl(url);
			input.setStatus("Waiting for sign-in...");
			try {
				void open(url, { wait: false }).catch(() => {
					input.setStatus("Could not open browser. Visit the URL below.");
				});
			} catch {
				input.setStatus("Could not open browser. Visit the URL below.");
			}
		},
		input.telemetry,
	)
		.then((credentials) => {
			if (input.isAborted()) return;
			saveLocalProviderOAuthCredentials(
				input.providerSettingsManager,
				input.providerId,
				existing,
				credentials,
			);
			if (isClineAccountOAuthProvider(input.providerId)) {
				void identifyFeatureFlagsAccount({
					id: credentials.accountId,
					email: credentials.email,
				}).catch(() => {});
			}
			input.onComplete(input.providerId);
		})
		.catch((err: unknown) => {
			if (input.isAborted()) return;
			input.setError(err instanceof Error ? err.message : String(err));
			input.setStatus("Authentication failed");
		});
}

export function runDeviceCodeAuthFlow(input: {
	providerId: OnboardingOAuthProviderId;
	providerSettingsManager: ProviderSettingsManager;
	isAborted: () => boolean;
	setUserCode: (code: string) => void;
	setVerifyUrl: (url: string) => void;
	setStatus: (status: string) => void;
	setError: (error: string) => void;
	onComplete: (providerId: OnboardingOAuthProviderId) => void;
	telemetry?: ITelemetryService;
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);
	const apiBaseUrl =
		existing?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl;

	// `startClineDeviceAuth` only requests the user/device code pair; the
	// `auth_started` telemetry event is emitted by `completeClineDeviceAuth`
	// (which owns the actual login lifecycle), so we intentionally do NOT
	// pass telemetry into `startClineDeviceAuth` here.
	startClineDeviceAuth()
		.then((result) => {
			if (input.isAborted()) return;
			const verifyUrl =
				result.verificationUriComplete || result.verificationUri;
			input.setUserCode(result.userCode);
			input.setVerifyUrl(verifyUrl);
			input.setStatus("Enter the code at the URL below");
			try {
				void open(verifyUrl, { wait: false }).catch(() => {
					input.setStatus("Could not open browser. Visit the URL below.");
				});
			} catch {
				input.setStatus("Could not open browser. Visit the URL below.");
			}

			completeClineDeviceAuth({
				deviceCode: result.deviceCode,
				expiresInSeconds: result.expiresInSeconds,
				pollIntervalSeconds: result.pollIntervalSeconds,
				apiBaseUrl,
				provider: input.providerId,
				telemetry: input.telemetry,
			})
				.then((credentials) => {
					if (input.isAborted()) return;
					saveLocalProviderOAuthCredentials(
						input.providerSettingsManager,
						input.providerId,
						existing,
						credentials,
					);
					if (isClineAccountOAuthProvider(input.providerId)) {
						void identifyFeatureFlagsAccount({
							id: credentials.accountId,
							email: credentials.email,
						}).catch(() => {});
					}
					input.onComplete(input.providerId);
				})
				.catch((err: unknown) => {
					if (input.isAborted()) return;
					input.setError(err instanceof Error ? err.message : String(err));
					input.setStatus("Authentication failed");
				});
		})
		.catch((err: unknown) => {
			if (input.isAborted()) return;
			input.setError(err instanceof Error ? err.message : String(err));
			input.setStatus("Could not start device code flow");
		});
}
