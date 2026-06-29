import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getClineCliMigrationNotice,
	markClineCliMigrationNoticeShown,
	resolveCliNoticeStatePath,
} from "./notice";

const tempDirs: string[] = [];

function createTempDataDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "cline-cli-notice-"));
	tempDirs.push(dir);
	return dir;
}

describe("migration notice", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns the notice for a fresh data dir", () => {
		const dataDir = createTempDataDir();

		expect(getClineCliMigrationNotice(dataDir)?.title).toBe("Try ClinePass");
	});

	it("shows when only the old Kanban notice was marked as shown", () => {
		const dataDir = createTempDataDir();
		const noticePath = resolveCliNoticeStatePath(dataDir);
		mkdirSync(dirname(noticePath), { recursive: true, mode: 0o700 });
		writeFileSync(
			noticePath,
			`${JSON.stringify(
				{ shown: { "cline-cli-tui-default": true } },
				null,
				2,
			)}\n`,
			"utf8",
		);

		expect(getClineCliMigrationNotice(dataDir)?.id).toBe(
			"cline-cli-cline-pass-intro",
		);
	});

	it("does not show after the notice is marked as shown", () => {
		const dataDir = createTempDataDir();

		markClineCliMigrationNoticeShown(dataDir);

		expect(getClineCliMigrationNotice(dataDir)).toBeUndefined();
	});

	it("shows after the notice is marked as shown when forced", () => {
		const dataDir = createTempDataDir();

		markClineCliMigrationNoticeShown(dataDir);

		expect(
			getClineCliMigrationNotice(dataDir, {
				CLINE_FORCE_CLINE_PASS_NOTICE: "1",
			}),
		).toBeDefined();
	});

	it("does not show when disabled through the environment", () => {
		const dataDir = createTempDataDir();

		expect(
			getClineCliMigrationNotice(dataDir, {
				CLINE_DISABLE_CLINE_PASS_NOTICE: "1",
			}),
		).toBeUndefined();
	});

	it("shows when forced even if disabled through the environment", () => {
		const dataDir = createTempDataDir();

		expect(
			getClineCliMigrationNotice(dataDir, {
				CLINE_DISABLE_CLINE_PASS_NOTICE: "1",
				CLINE_FORCE_CLINE_PASS_NOTICE: "1",
			}),
		).toBeDefined();
	});

	it("marks the notice as shown", () => {
		const dataDir = createTempDataDir();

		markClineCliMigrationNoticeShown(dataDir);

		const rawState = readFileSync(resolveCliNoticeStatePath(dataDir), "utf8");
		expect(rawState).toContain("cline-cli-cline-pass-intro");
		expect(getClineCliMigrationNotice(dataDir)).toBeUndefined();
	});
});
