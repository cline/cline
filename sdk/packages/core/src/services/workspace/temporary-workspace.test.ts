import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isTemporaryWorkspacePath,
	resolveTemporaryWorkspacePath,
} from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StartSessionConfig } from "../../runtime/host/runtime-host";
import {
	createTemporaryWorkspace,
	resolveStartSessionWorkspace,
} from "./temporary-workspace";

function createConfig(
	overrides: Partial<StartSessionConfig> = {},
): StartSessionConfig {
	return {
		providerId: "test-provider",
		modelId: "test-model",
		systemPrompt: "",
		enableTools: false,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		...overrides,
	};
}

describe("temporary session workspaces", () => {
	let previousDataDir: string | undefined;
	let isolatedDataDir: string;

	beforeEach(async () => {
		previousDataDir = process.env.CLINE_DATA_DIR;
		isolatedDataDir = await mkdtemp(join(tmpdir(), "temp-workspace-test-"));
		process.env.CLINE_DATA_DIR = isolatedDataDir;
	});

	afterEach(async () => {
		if (previousDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR;
		} else {
			process.env.CLINE_DATA_DIR = previousDataDir;
		}
		await rm(isolatedDataDir, { recursive: true, force: true });
	});

	it("creates the session workspace under the cline data directory", async () => {
		const sessionId = "session-a1b2c3";
		const workspace = await createTemporaryWorkspace(sessionId);
		expect(workspace).toBe(resolveTemporaryWorkspacePath(sessionId));
		expect(workspace).toBe(
			join(isolatedDataDir, "workspaces", sessionId, "project"),
		);
	});

	it("recognizes the default data-dir layout as a temporary workspace", () => {
		expect(
			isTemporaryWorkspacePath(
				"/home/user/.cline/data/workspaces/session-a1b2c3/project",
			),
		).toBe(true);
	});

	it.each([
		"../outside",
		"session\\outside",
		"session with spaces",
	])("rejects unsafe session ID %s", async (sessionId) => {
		await expect(createTemporaryWorkspace(sessionId)).rejects.toThrow(
			"sessionId must contain only letters, numbers, underscores, or hyphens",
		);
	});

	it("reuses a session workspace without clearing its contents", async () => {
		const sessionId = "session-resume";
		const workspace = await createTemporaryWorkspace(sessionId);
		const draftPath = join(workspace, "draft.txt");
		await writeFile(draftPath, "keep me");
		expect(await createTemporaryWorkspace(sessionId)).toBe(workspace);
		expect(await readFile(draftPath, "utf8")).toBe("keep me");
	});

	it("uses one provided workspace path for both resolved fields", async () => {
		await expect(
			resolveStartSessionWorkspace(
				createConfig({ cwd: "/repo/app" }),
				"session-provided-cwd",
			),
		).resolves.toMatchObject({
			cwd: "/repo/app",
			workspaceRoot: "/repo/app",
		});
		await expect(
			resolveStartSessionWorkspace(
				createConfig({ workspaceRoot: "/repo/root" }),
				"session-provided-root",
			),
		).resolves.toMatchObject({
			cwd: "/repo/root",
			workspaceRoot: "/repo/root",
		});
	});

	it("creates and assigns a temporary workspace when both paths are omitted", async () => {
		const sessionId = "session-pathless";
		const resolved = await resolveStartSessionWorkspace(
			createConfig(),
			sessionId,
		);
		expect(resolved.cwd).toBe(resolved.workspaceRoot);
		expect(resolved.cwd).toBe(resolveTemporaryWorkspacePath(sessionId));
	});
});
