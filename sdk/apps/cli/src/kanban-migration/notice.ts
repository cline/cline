import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

const NOTICE_ID = "cline-cli-tui-default";
const FORCE_NOTICE_ENV = "CLINE_FORCE_MIGRATION_NOTICE";
const DISABLE_NOTICE_ENV = "CLINE_DISABLE_MIGRATION_NOTICE";

export interface CliMigrationNotice {
	id: string;
	title: string;
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

export function resolveCliNoticeStatePath(
	dataDir = resolveClineDataDir(),
): string {
	return join(dataDir, "settings", "cli-notices.json");
}

export function getClineCliMigrationNotice(
	dataDir = resolveClineDataDir(),
	env: NodeJS.ProcessEnv = process.env,
): CliMigrationNotice | undefined {
	const noticePath = resolveCliNoticeStatePath(dataDir);
	const noticeState = readNoticeState(noticePath);
	const forceNotice = env[FORCE_NOTICE_ENV]?.trim() === "1";
	const disableNotice = env[DISABLE_NOTICE_ENV]?.trim() === "1";
	if (disableNotice && !forceNotice) {
		return undefined;
	}
	if (noticeState.shown[NOTICE_ID] && !forceNotice) {
		return undefined;
	}
	return {
		id: NOTICE_ID,
		title: "Welcome to the new Cline CLI",
	};
}

export function markClineCliMigrationNoticeShown(
	dataDir = resolveClineDataDir(),
): void {
	const noticePath = resolveCliNoticeStatePath(dataDir);
	const noticeState = readNoticeState(noticePath);
	const nextState: CliNoticeState = {
		shown: {
			...noticeState.shown,
			[NOTICE_ID]: true,
		},
	};
	mkdirSync(dirname(noticePath), { recursive: true, mode: 0o700 });
	writeFileSync(noticePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}
