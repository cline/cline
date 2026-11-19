import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import type { SidecarContext, SidecarWebSocketClient } from "./types";

const mocks = vi.hoisted(() => ({
	hubCommand: vi.fn(),
	ensureSharedHubClient: vi.fn(),
	createUserInstructionConfigService: vi.fn(),
}));

vi.mock("./context", async (importOriginal) => ({
	...(await importOriginal<typeof import("./context")>()),
	ensureSharedHubClient: mocks.ensureSharedHubClient,
}));

vi.mock("@cline/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/core")>()),
	createUserInstructionConfigService: mocks.createUserInstructionConfigService,
	resolveAgentConfigSearchPaths: () => [],
	listHookConfigFiles: () => [],
	readGlobalSettings: () => ({}),
	isModelToolEnabledGlobally: () => true,
	createHubMcpApi: () => ({ list: async () => [] }),
}));

let directory: string;
let skillPath: string;
let ctx: SidecarContext;

beforeEach(async () => {
	vi.resetAllMocks();
	directory = await mkdtemp(
		join(tmpdir(), "commands-installed-skill-preview-"),
	);
	skillPath = join(directory, "SKILL.md");
	await writeFile(skillPath, "# Installed skill\n");
	await writeFile(join(directory, ".env"), "EXAMPLE_VALUE=private-fixture\n");
	ctx = { localWorkspaceRoot: directory } as SidecarContext;
	mocks.ensureSharedHubClient.mockResolvedValue({ command: mocks.hubCommand });
	mocks.hubCommand.mockResolvedValue({
		ok: true,
		payload: {
			snapshot: {
				skills: [
					{ id: "skill", name: "Skill", path: skillPath, agentPlugin: true },
				],
				plugins: [],
				tools: [],
			},
		},
	});
	mocks.createUserInstructionConfigService.mockReturnValue({
		start: async () => {},
		stop: () => {},
		listRecords: () => [],
		listRuntimeCommands: () => [],
	});
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe.each([
	"get_installed_skill_preview",
	"read_installed_skill_file",
])("%s access control", (command) => {
	it.each([
		{ label: "missing connection", connection: undefined },
		{ label: "missing connection data", connection: { send: vi.fn() } },
		{ label: "missing approval flag", connection: { send: vi.fn(), data: {} } },
		{
			label: "untrusted connection",
			connection: { send: vi.fn(), data: { canApproveTools: false } },
		},
	])("rejects $label before loading local inventory", async ({
		connection,
	}) => {
		await expect(
			handleCommand(ctx, command, { skillPath, path: ".env" }, { connection }),
		).rejects.toThrow(
			"installed skill files require a trusted desktop connection",
		);
		expect(mocks.ensureSharedHubClient).not.toHaveBeenCalled();
		expect(mocks.createUserInstructionConfigService).not.toHaveBeenCalled();
	});

	it("allows the trusted desktop connection to preview installed files", async () => {
		const connection: SidecarWebSocketClient = {
			send: vi.fn(),
			data: { canApproveTools: true },
		};
		const result = await handleCommand(
			ctx,
			command,
			{ skillPath, path: ".env" },
			{ connection },
		);
		if (command === "get_installed_skill_preview") {
			expect(result).toMatchObject({
				defaultPath: "SKILL.md",
				files: [
					{ path: ".env", size: 30 },
					{ path: "SKILL.md", size: 18 },
				],
			});
		} else {
			expect(result).toMatchObject({
				path: ".env",
				content: "EXAMPLE_VALUE=private-fixture\n",
			});
		}
		expect(mocks.hubCommand).toHaveBeenCalledWith("settings.list", {
			workspaceRoot: directory,
			cwd: directory,
		});
	});
});
