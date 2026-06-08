import {
	getClineEnvironmentConfig,
	isClineAccountAuthRequiredErrorInfo,
	isClineInsufficientCreditsErrorInfo,
	type SdkErrorInfo,
	type SdkProviderErrorInfo,
} from "@cline/shared";
import { formatCreditBalance } from "./output";

export type SpecialErrorDisplay =
	| {
			kind: "cline_credits_depleted";
			title: string;
			message: string;
			balanceText?: string;
			url: string;
	  }
	| {
			kind: "cline_account_auth_required";
			title: string;
			message: string;
			command: string;
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getDetailsValue(
	errorInfo: SdkProviderErrorInfo,
	...keys: string[]
): unknown {
	const details = errorInfo.details;
	if (!isRecord(details)) {
		return undefined;
	}
	for (const key of keys) {
		if (key in details) {
			return details[key];
		}
	}
	return undefined;
}

function getDetailsString(
	errorInfo: SdkProviderErrorInfo,
	...keys: string[]
): string | undefined {
	const value = getDetailsValue(errorInfo, ...keys);
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function getDetailsNumber(
	errorInfo: SdkProviderErrorInfo,
	...keys: string[]
): number | undefined {
	const value = getDetailsValue(errorInfo, ...keys);
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (
		typeof value === "string" &&
		value.trim().length > 0 &&
		Number.isFinite(Number(value))
	) {
		return Number(value);
	}
	return undefined;
}

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" || parsed.protocol === "http:";
	} catch {
		return false;
	}
}

function resolveClineCreditsUrl(errorInfo: SdkProviderErrorInfo): string {
	const detailUrl = getDetailsString(
		errorInfo,
		"buy_credits_url",
		"buyCreditsUrl",
		"dashboard_url",
		"dashboardUrl",
	);
	if (detailUrl && isHttpUrl(detailUrl)) {
		return detailUrl;
	}
	const { appBaseUrl } = getClineEnvironmentConfig();
	return `${appBaseUrl}/dashboard/account?tab=credits`;
}

function resolveClineCreditsDisplay(
	errorInfo: SdkErrorInfo,
): SpecialErrorDisplay | undefined {
	if (!isClineInsufficientCreditsErrorInfo(errorInfo)) {
		return undefined;
	}
	const currentBalance = getDetailsNumber(
		errorInfo,
		"current_balance",
		"currentBalance",
	);
	const balance =
		currentBalance === undefined
			? undefined
			: Object.is(currentBalance, -0)
				? 0
				: currentBalance;
	return {
		kind: "cline_credits_depleted",
		title: "Cline Credits depleted",
		message:
			"You have run out of Cline credits. Add credits in the dashboard to continue.",
		...(balance !== undefined
			? { balanceText: formatCreditBalance(balance) }
			: {}),
		url: resolveClineCreditsUrl(errorInfo),
	};
}

function resolveClineAccountAuthDisplay(
	errorInfo: SdkErrorInfo,
): SpecialErrorDisplay | undefined {
	if (!isClineAccountAuthRequiredErrorInfo(errorInfo)) {
		return undefined;
	}
	return {
		kind: "cline_account_auth_required",
		title: "Cline account sign-in required",
		message: "Sign in to your Cline account to continue.",
		command: "/account",
	};
}

export function resolveSpecialErrorDisplay(
	errorInfo: SdkErrorInfo | undefined,
): SpecialErrorDisplay | undefined {
	if (!errorInfo) {
		return undefined;
	}
	switch (errorInfo.kind) {
		case "provider":
			return resolveClineCreditsDisplay(errorInfo);
		case "auth":
			return resolveClineAccountAuthDisplay(errorInfo);
	}
}

export function formatSpecialErrorText(
	errorInfo: SdkErrorInfo | undefined,
): string | undefined {
	const display = resolveSpecialErrorDisplay(errorInfo);
	if (!display) {
		return undefined;
	}
	switch (display.kind) {
		case "cline_credits_depleted":
			return [
				display.title,
				display.message,
				display.balanceText
					? `Current balance: ${display.balanceText}`
					: undefined,
				`Dashboard: ${display.url}`,
			]
				.filter((line): line is string => Boolean(line))
				.join("\n");
		case "cline_account_auth_required":
			return [
				display.title,
				display.message,
				`Open ${display.command} to sign in, then retry your message.`,
			].join("\n");
	}
}
