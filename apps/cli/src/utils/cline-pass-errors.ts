import {
	getClinePassSubscriptionUrl,
	isClineNotSubscribedError,
	isClineNotSubscribedMessage,
} from "@cline/core";

export { getClinePassSubscriptionUrl };

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

export function formatCliErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}
