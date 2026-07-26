import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type EnvSnapshot = {
	HOME: string | undefined;
	USERPROFILE: string | undefined;
	HOMEDRIVE: string | undefined;
	HOMEPATH: string | undefined;
	BEDROCK_CODER_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		HOME: process.env.HOME,
		USERPROFILE: process.env.USERPROFILE,
		HOMEDRIVE: process.env.HOMEDRIVE,
		HOMEPATH: process.env.HOMEPATH,
		BEDROCK_CODER_DIR: process.env.BEDROCK_CODER_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.HOME = snapshot.HOME;
	process.env.USERPROFILE = snapshot.USERPROFILE;
	process.env.HOMEDRIVE = snapshot.HOMEDRIVE;
	process.env.HOMEPATH = snapshot.HOMEPATH;
	process.env.BEDROCK_CODER_DIR = snapshot.BEDROCK_CODER_DIR;
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
		delete process.env.BEDROCK_CODER_DIR;

		const { resolveBedrockCoderDir } = await import("./paths");
		expect(resolveBedrockCoderDir()).toBe(join("C:\\Users\\saoud", ".bedrock-coder"));
	});

	it("treats HOME=~ as unset and falls back to USERPROFILE", async () => {
		snapshot = captureEnv();
		process.env.HOME = "~";
		process.env.USERPROFILE = "C:\\Users\\saoud";
		delete process.env.HOMEDRIVE;
		delete process.env.HOMEPATH;
		delete process.env.BEDROCK_CODER_DIR;

		const { resolveBedrockCoderDir } = await import("./paths");
		expect(resolveBedrockCoderDir()).toBe(join("C:\\Users\\saoud", ".bedrock-coder"));
	});
});
