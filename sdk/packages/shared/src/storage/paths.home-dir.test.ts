import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type EnvSnapshot = {
	HOME: string | undefined;
	USERPROFILE: string | undefined;
	HOMEDRIVE: string | undefined;
	HOMEPATH: string | undefined;
	CLINE_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
		HOMEDRIVE: process.env.HOMEDRIVE,
		HOMEPATH: process.env.HOMEPATH,
		CLINE_DIR: process.env.CLINE_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.HOME = snapshot.HOME;
	process.env.USERPROFILE = snapshot.USERPROFILE;
	process.env.HOMEDRIVE = snapshot.HOMEDRIVE;
	process.env.HOMEPATH = snapshot.HOMEPATH;
	process.env.CLINE_DIR = snapshot.CLINE_DIR;
}

describe("storage home directory fallback", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
		vi.resetModules();
	});

	it("uses USERPROFILE when HOME is unset", async () => {
		snapshot = captureEnv();
		delete process.env.HOME;
		process.env.USERPROFILE = "C:\\Users\\saoud";
		delete process.env.HOMEDRIVE;
		delete process.env.HOMEPATH;
		delete process.env.CLINE_DIR;

		const { resolveClineDir } = await import("./paths");
		expect(resolveClineDir()).toBe(join("C:\\Users\\saoud", ".cline"));
	});

	it("treats HOME=~ as unset and falls back to USERPROFILE", async () => {
		snapshot = captureEnv();
		process.env.HOME = "~";
		process.env.USERPROFILE = "C:\\Users\\saoud";
		delete process.env.HOMEDRIVE;
		delete process.env.HOMEPATH;
		delete process.env.CLINE_DIR;

		const { resolveClineDir } = await import("./paths");
		expect(resolveClineDir()).toBe(join("C:\\Users\\saoud", ".cline"));
	});
});
