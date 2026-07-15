import {
	type ClineSubscriptionPlan,
	extractClinePassLimitMessage,
	getClineOrgIndividualInferenceSubscriptionMessage,
	isClineNotSubscribedError,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionError,
	isClineOrgIndividualInferenceSubscriptionMessage,
	isClinePassLimitError,
	isClinePassLimitMessage,
} from "@cline/core";

import { getClineEnvironmentConfig } from "@cline/shared";

export { getClineOrgIndividualInferenceSubscriptionMessage };

export const CLI_PROMO_CODE = "CLI-8OFF";

export function getCliSubscriptionUrl(): string {
	return `${new URL(
		`/promo?code=${CLI_PROMO_CODE}&personal=true`,
		getClineEnvironmentConfig().appBaseUrl,
	).toString()}`;
}

export function getCliNotSubscribedMessage(): string {
	return `No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: ${getCliSubscriptionUrl()}`;
}

export function getCliClinePassLimitMessage(message: string): string {
	const detail = getClinePassLimitDetailMessage(message) ?? message.trim();
	const lines = [
		"ClinePass limit reached",
		detail,
		"Switch to Cline usage-based billing and retry with the Cline provider.",
		"Interactive CLI: open the model selector with /model, choose Cline, then retry.",
		"Headless CLI: rerun with --provider cline.",
	];
	return lines.filter((line) => line.trim().length > 0).join("\n");
}

export function getIndividualPlanFeatures(
	plans: ClineSubscriptionPlan[],
): string[] {
	const planWithFeatures = plans.find((plan) => plan.interval === "Monthly");

	return planWithFeatures?.features?.included ?? [];
}

function isFormattedClinePassSubscriptionMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	return (
		normalized.includes("no access to clinepass subscription models yet") &&
		normalized.includes("subscribe to clinepass")
	);
}

export function isClinePassSubscriptionError(error: unknown): boolean {
	if (isClineNotSubscribedError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "ClineNotSubscribedError" ||
			isClineNotSubscribedMessage(error.message) ||
			isFormattedClinePassSubscriptionMessage(error.message)
		);
	}
	return (
		typeof error === "string" &&
		(isClineNotSubscribedMessage(error) ||
			isFormattedClinePassSubscriptionMessage(error))
	);
}

export function isClineOrgIndividualInferenceSubscriptionErrorMessage(
	error: unknown,
): boolean {
	if (isClineOrgIndividualInferenceSubscriptionError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "ClineOrgIndividualInferenceSubscriptionError" ||
			isClineOrgIndividualInferenceSubscriptionMessage(error.message) ||
			error.message === getClineOrgIndividualInferenceSubscriptionMessage()
		);
	}
	return (
		typeof error === "string" &&
		(isClineOrgIndividualInferenceSubscriptionMessage(error) ||
			error === getClineOrgIndividualInferenceSubscriptionMessage())
	);
}

export function getClinePassLimitDetailMessage(
	error: unknown,
): string | undefined {
	return extractClinePassLimitMessage(
		error instanceof Error ? error.message : String(error),
	);
}

export function isClinePassLimitErrorMessage(error: unknown): boolean {
	if (isClinePassLimitError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "ClinePassLimitError" ||
			isClinePassLimitMessage(error.message)
		);
	}
	return typeof error === "string" && isClinePassLimitMessage(error);
}

export function formatCliErrorMessage(error: unknown): string {
	if (isClinePassSubscriptionError(error)) {
		return getCliNotSubscribedMessage();
	}
	if (isClineOrgIndividualInferenceSubscriptionErrorMessage(error)) {
		return getClineOrgIndividualInferenceSubscriptionMessage();
	}
	if (isClinePassLimitErrorMessage(error)) {
		return getCliClinePassLimitMessage(
			error instanceof Error ? error.message : String(error),
		);
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
