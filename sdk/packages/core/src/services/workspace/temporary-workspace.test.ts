import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	isTemporaryWorkspacePath,
	resolveTemporaryWorkspacePath,
} from "@cline/shared/storage";
import { describe, expect, it } from "vitest";
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
	it("creates the session workspace under the system temp directory", async () => {
		const sessionId = "session-a1b2c3";
		const workspace = await createTemporaryWorkspace(sessionId);
		try {
			expect(workspace).toBe(resolveTemporaryWorkspacePath(sessionId));
			expect(isTemporaryWorkspacePath(workspace)).toBe(true);
		} finally {
			await rm(dirname(workspace), { recursive: true, force: true });
		}
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
		try {
			await writeFile(draftPath, "keep me");
			expect(await createTemporaryWorkspace(sessionId)).toBe(workspace);
			expect(await readFile(draftPath, "utf8")).toBe("keep me");
		} finally {
			await rm(dirname(workspace), { recursive: true, force: true });
		}
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
		try {
			expect(resolved.cwd).toBe(resolved.workspaceRoot);
			expect(resolved.cwd).toBe(resolveTemporaryWorkspacePath(sessionId));
			expect(isTemporaryWorkspacePath(resolved.cwd)).toBe(true);
		} finally {
			await rm(dirname(resolved.cwd), { recursive: true, force: true });
		}
	});
});
