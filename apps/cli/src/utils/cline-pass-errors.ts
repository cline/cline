import {
	isClineNotSubscribedError,
	isClineNotSubscribedMessage,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";

export function getClinePassSubscriptionUrl(): string {
	return `${new URL(
		"/dashboard/subscription",
		getClineEnvironmentConfig().appBaseUrl,
	).toString()}/`;
}

export function isClinePassSubscriptionError(error: unknown): boolean {
	if (isClineNotSubscribedError(error)) {
		return true;
	}
	if (error instanceof Error) {
		return (
			error.name === "ClineNotSubscribedError" ||
			isClineNotSubscribedMessage(error.message)
		);
	}
	return typeof error === "string" && isClineNotSubscribedMessage(error);
}

export function formatCliErrorMessage(error: unknown): string {
	if (isClinePassSubscriptionError(error)) {
		return `No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: ${getClinePassSubscriptionUrl()}`;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
