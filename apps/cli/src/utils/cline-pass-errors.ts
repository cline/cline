import {
	getClineOrgIndividualInferenceSubscriptionMessage,
	isClineNotSubscribedError,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionError,
	isClineOrgIndividualInferenceSubscriptionMessage,
} from "@cline/core";

import { getClineEnvironmentConfig } from "@cline/shared";

export { getClineOrgIndividualInferenceSubscriptionMessage };

export function getCliSubscriptionUrl(): string {
	return `${new URL(
		"/promo?code=CLI-8OFF&personal=true",
		getClineEnvironmentConfig().appBaseUrl,
	).toString()}`;
}

export function getCliNotSubscribedMessage(): string {
	return `No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: ${getCliSubscriptionUrl()}`;
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

export function formatCliErrorMessage(error: unknown): string {
	if (isClinePassSubscriptionError(error)) {
		return getCliNotSubscribedMessage();
	}
	if (isClineOrgIndividualInferenceSubscriptionErrorMessage(error)) {
		return getClineOrgIndividualInferenceSubscriptionMessage();
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
