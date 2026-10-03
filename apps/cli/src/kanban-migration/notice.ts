import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";
import { getCliSubscriptionUrl } from "../utils/cline-pass-errors";

export const CLINE_PASS_NOTICE_ID = "cline-cli-cline-pass-intro";
const DESKTOP_NOTICE_ID = "cline-cli-desktop-launch";
const FORCE_NOTICE_ENV = "CLINE_FORCE_CLINE_PASS_NOTICE";
// Historically named for the ClinePass promo; disables every startup notice.
const DISABLE_NOTICE_ENV = "CLINE_DISABLE_CLINE_PASS_NOTICE";
const DESKTOP_APP_URL = "https://cline.bot/desktop";

export interface CliMigrationNotice {
	id: string;
	title: string;
	body: string;
	url: string;
	openLabel: string;
}

export interface CliMigrationNoticeOptions {
	activeProviderId?: string;
}

function getClinePassNotice(): CliMigrationNotice {
	return {
		id: CLINE_PASS_NOTICE_ID,
		title: "Try ClinePass",
		body: "ClinePass is a $9.99/month subscription plan to get access to the latest open-weight coding models with enough quota for day-to-day work, at a much lower cost than paying API costs directly.",
		url: getCliSubscriptionUrl(),
		openLabel: "Open ClinePass",
	};
}

function getDesktopNotice(): CliMigrationNotice {
	return {
		id: DESKTOP_NOTICE_ID,
		title: "Introducing Cline Desktop",
		body: [
			"A native app for working with open weights models. Use it with ClinePass and our free models, or BYOK.",
			"- Import tasks from Claude Code and Codex",
			"- Run Cline on a regular schedule",
			"- Use web search tool and voice input",
			"- Browse Marketplace for plugins, MCPs, and skills",
			"Available for macOS and Windows.",
		].join("\n"),
		url: DESKTOP_APP_URL,
		openLabel: "Get Cline Desktop",
	};
}

interface CliNoticeState {
	shown: Record<string, boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function readNoticeState(filePath: string): CliNoticeState {
	const parsed = readJsonRecord(filePath);
	const shown: Record<string, boolean> = {};
	if (!parsed) {
		return { shown };
	}
	const rawShown = parsed.shown;
	if (!isRecord(rawShown)) {
		return { shown };
	}
	for (const [key, value] of Object.entries(rawShown)) {
		if (typeof value === "boolean") {
			shown[key] = value;
		}
	}
	return { shown };
}

function isForceNoticeEnabled(env: NodeJS.ProcessEnv): boolean {
	return env[FORCE_NOTICE_ENV]?.trim() === "1";
}

export function shouldSuppressClineCliMigrationNoticeForActiveProvider(
	activeProviderId: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return (
		activeProviderId?.trim() === "cline-pass" && !isForceNoticeEnabled(env)
	);
}

export function resolveCliNoticeStatePath(
	dataDir = resolveClineDataDir(),
): string {
	return join(dataDir, "settings", "cli-notices.json");
}

export function getClineCliMigrationNotice(
	dataDir = resolveClineDataDir(),
	env: NodeJS.ProcessEnv = process.env,
	options: CliMigrationNoticeOptions = {},
): CliMigrationNotice | undefined {
	const noticePath = resolveCliNoticeStatePath(dataDir);
	const noticeState = readNoticeState(noticePath);
	const forceNotice = isForceNoticeEnabled(env);
	const disableNotice = env[DISABLE_NOTICE_ENV]?.trim() === "1";
	if (disableNotice && !forceNotice) {
		return undefined;
	}
	// At most one notice per launch, oldest first, so a user who has already
	// dismissed the ClinePass intro sees the desktop launch on their next start.
	if (
		!shouldSuppressClineCliMigrationNoticeForActiveProvider(
			options.activeProviderId,
			env,
		) &&
		(forceNotice || !noticeState.shown[CLINE_PASS_NOTICE_ID])
	) {
		return getClinePassNotice();
	}
	if (!noticeState.shown[DESKTOP_NOTICE_ID]) {
		return getDesktopNotice();
	}
	return undefined;
}

export function markClineCliMigrationNoticeShown(
	dataDir = resolveClineDataDir(),
	noticeId = CLINE_PASS_NOTICE_ID,
): void {
	const noticePath = resolveCliNoticeStatePath(dataDir);
	const noticeState = readNoticeState(noticePath);
	const nextState: CliNoticeState = {
		shown: {
			...noticeState.shown,
			[noticeId]: true,
		},
	};
	mkdirSync(dirname(noticePath), { recursive: true, mode: 0o700 });
	writeFileSync(noticePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}
