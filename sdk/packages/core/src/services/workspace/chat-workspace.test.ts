import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isChatWorkspacePath,
	resolveChatWorkspacePath,
} from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StartSessionConfig } from "../../runtime/host/runtime-host";
import {
	ensureChatWorkspace,
	resolveStartSessionWorkspace,
} from "./chat-workspace";

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

describe("chat workspace", () => {
	let previousDataDir: string | undefined;
	let isolatedDataDir: string;

	beforeEach(async () => {
		previousDataDir = process.env.CLINE_DATA_DIR;
		isolatedDataDir = await mkdtemp(join(tmpdir(), "chat-workspace-test-"));
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

	it("creates the shared chat workspace under the cline data directory", async () => {
		const workspace = await ensureChatWorkspace();
		expect(workspace).toBe(resolveChatWorkspacePath());
		expect(workspace).toBe(join(isolatedDataDir, "workspaces", "chat"));
	});

	it("seeds the chat workspace rules file", async () => {
		const workspace = await ensureChatWorkspace();
		const rules = await readFile(join(workspace, "AGENTS.md"), "utf8");
		expect(rules).toContain("shared workspace for chat sessions");
		expect(rules).toContain("do not create");
	});

	it("keeps a user-edited rules file", async () => {
		const workspace = await ensureChatWorkspace();
		const rulesPath = join(workspace, "AGENTS.md");
		await writeFile(rulesPath, "my custom rules");
		await ensureChatWorkspace();
		expect(await readFile(rulesPath, "utf8")).toBe("my custom rules");
	});

	it("recognizes the default data-dir layout as the chat workspace", () => {
		expect(isChatWorkspacePath("/home/user/.cline/data/workspaces/chat")).toBe(
			true,
		);
		expect(
			isChatWorkspacePath("/home/user/.cline/data/workspaces/chat/my-app"),
		).toBe(false);
	});

	it("reuses the chat workspace without clearing its contents", async () => {
		const workspace = await ensureChatWorkspace();
		const draftPath = join(workspace, "draft.txt");
		await writeFile(draftPath, "keep me");
		expect(await ensureChatWorkspace()).toBe(workspace);
		expect(await readFile(draftPath, "utf8")).toBe("keep me");
	});

	it("uses one provided workspace path for both resolved fields", async () => {
		await expect(
			resolveStartSessionWorkspace(createConfig({ cwd: "/repo/app" })),
		).resolves.toMatchObject({
			cwd: "/repo/app",
			workspaceRoot: "/repo/app",
		});
		await expect(
			resolveStartSessionWorkspace(
				createConfig({ workspaceRoot: "/repo/root" }),
			),
		).resolves.toMatchObject({
			cwd: "/repo/root",
			workspaceRoot: "/repo/root",
		});
	});

	it("assigns the shared chat workspace when both paths are omitted", async () => {
		const resolved = await resolveStartSessionWorkspace(createConfig());
		expect(resolved.cwd).toBe(resolved.workspaceRoot);
		expect(resolved.cwd).toBe(resolveChatWorkspacePath());
	});
});
