import {
	completeClineDeviceAuth,
	loginLocalProvider,
	type ProviderSettingsManager,
	saveLocalProviderOAuthCredentials,
	startClineDeviceAuth,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import open from "open";

export type OnboardingOAuthProviderId = "cline" | "oca" | "openai-codex";

export function isOnboardingOAuthProviderId(
	providerId: string,
): providerId is OnboardingOAuthProviderId {
	return (
		providerId === "cline" ||
		providerId === "oca" ||
		providerId === "openai-codex"
	);
}

export function runOAuthAuthFlow(input: {
	providerId: OnboardingOAuthProviderId;
	providerSettingsManager: ProviderSettingsManager;
	isAborted: () => boolean;
	setStatus: (status: string) => void;
	setAuthUrl: (url: string) => void;
	setError: (error: string) => void;
	onComplete: (providerId: OnboardingOAuthProviderId) => void;
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);

	loginLocalProvider(input.providerId, existing, (url: string) => {
		input.setAuthUrl(url);
		input.setStatus("Waiting for sign-in...");
		try {
			void open(url, { wait: false }).catch(() => {
				input.setStatus("Could not open browser. Visit the URL below.");
			});
		} catch {
			input.setStatus("Could not open browser. Visit the URL below.");
		}
	})
		.then((credentials) => {
			if (input.isAborted()) return;
			saveLocalProviderOAuthCredentials(
				input.providerSettingsManager,
				input.providerId,
				existing,
				credentials,
			);
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
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);
	const apiBaseUrl =
		existing?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl;

	startClineDeviceAuth()
		.then((result) => {
			if (input.isAborted()) return;
			input.setUserCode(result.userCode);
			input.setVerifyUrl(
				result.verificationUriComplete || result.verificationUri,
			);
			input.setStatus("Enter the code at the URL below");

			completeClineDeviceAuth({
				deviceCode: result.deviceCode,
				expiresInSeconds: result.expiresInSeconds,
				pollIntervalSeconds: result.pollIntervalSeconds,
				apiBaseUrl,
				provider: input.providerId,
			})
				.then((credentials) => {
					if (input.isAborted()) return;
					saveLocalProviderOAuthCredentials(
						input.providerSettingsManager,
						input.providerId,
						existing,
						credentials,
					);
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
