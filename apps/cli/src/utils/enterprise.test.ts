import fs, {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ClineAccountService,
	type ClineCoreStartInput,
	createUserInstructionConfigService,
	ProviderSettingsManager,
	type RuleConfig,
} from "@cline/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareCliEnterpriseIntegration } from "./enterprise";

vi.mock("./telemetry", () => ({
	getCliTelemetryService: () => ({ capture: vi.fn() }),
}));

const pirateRule = "Talk like a pirate.";
const enabledResponse = {
	enabled: true,
	organizationId: "org-test",
	value: JSON.stringify({
		version: "v1",
		globalRules: [
			{ name: "Piratical", contents: pirateRule, alwaysEnabled: false },
		],
		globalWorkflows: [
			{ name: "Triage", contents: "Triage this task.", alwaysEnabled: false },
		],
	}),
};

describe("CLI enterprise preparation", () => {
	let workspacePath: string;
	let input: ClineCoreStartInput;

	beforeEach(async () => {
		workspacePath = await mkdtemp(join(tmpdir(), "cli-enterprise-"));
		input = {
			config: {
				cwd: workspacePath,
				workspaceRoot: workspacePath,
				providerId: "cline",
				modelId: "test-model",
				systemPrompt: "Test enterprise instruction discovery.",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		};
		vi.spyOn(
			ProviderSettingsManager.prototype,
			"getProviderSettings",
		).mockReturnValue({
			provider: "cline",
			auth: { accessToken: "test-token" },
		});
		vi.spyOn(
			ClineAccountService.prototype,
			"fetchRemoteConfig",
		).mockResolvedValue(enabledResponse);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(workspacePath, { recursive: true, force: true });
	});

	async function discoverRules(): Promise<string[]> {
		const service = createUserInstructionConfigService({
			rules: { directories: [], workspacePath },
			skills: { directories: [] },
			workflows: { directories: [] },
		});
		try {
			await service.start();
			return service
				.listRecords<RuleConfig>("rule")
				.map(({ item }) => item.instructions);
		} finally {
			service.stop();
		}
	}

	async function materializeEnabledConfig() {
		const integration = await prepareCliEnterpriseIntegration(input);
		if (!integration) {
			throw new Error("Expected configured enterprise integration");
		}
		await integration.dispose();
		return integration.prepared.paths;
	}

	it.each([
		["no config", null],
		["disabled config", { ...enabledResponse, enabled: false }],
	])("removes managed instructions when the account returns %s", async (_label, response) => {
		const paths = await materializeEnabledConfig();
		expect(await discoverRules()).toEqual([
			expect.stringContaining(pirateRule),
		]);
		await mkdir(join(paths.skillsPath, "managed-skill"), { recursive: true });
		await writeFile(
			join(paths.skillsPath, "managed-skill", "SKILL.md"),
			"Managed skill.",
		);
		await mkdir(join(workspacePath, ".cline", "rules"), { recursive: true });
		await writeFile(
			join(workspacePath, ".cline", "rules", "personal.md"),
			"Keep personal rules.",
		);
		vi.mocked(
			ClineAccountService.prototype.fetchRemoteConfig,
		).mockResolvedValue(response);

		expect(await prepareCliEnterpriseIntegration(input)).toBeUndefined();

		expect(await discoverRules()).toEqual([]);
		const service = createUserInstructionConfigService({
			rules: { directories: [], workspacePath },
			skills: { directories: [], workspacePath },
			workflows: { directories: [], workspacePath },
		});
		try {
			await service.start();
			expect(service.listRecords("skill")).toEqual([]);
			expect(service.listRecords("workflow")).toEqual([]);
		} finally {
			service.stop();
		}
		for (const filePath of [
			paths.rulesFilePath,
			paths.manifestPath,
			paths.bundleCachePath,
		]) {
			await expect(readFile(filePath, "utf8")).rejects.toMatchObject({
				code: "ENOENT",
			});
		}
		expect(await readdir(paths.workflowsPath)).toEqual([]);
		expect(await readdir(paths.skillsPath)).toEqual([]);
		expect(
			await readFile(
				join(workspacePath, ".cline", "rules", "personal.md"),
				"utf8",
			),
		).toBe("Keep personal rules.");
		// Repeated disable is idempotent; re-enabling recreates discoverable rules.
		await prepareCliEnterpriseIntegration(input);
		vi.mocked(
			ClineAccountService.prototype.fetchRemoteConfig,
		).mockResolvedValue(enabledResponse);
		const reenabled = await prepareCliEnterpriseIntegration(input);
		await reenabled?.dispose();
		expect(await discoverRules()).toEqual([
			expect.stringContaining(pirateRule),
		]);
	});

	it("preserves previously materialized rules when the request fails", async () => {
		const integration = await prepareCliEnterpriseIntegration(input);
		await integration?.dispose();
		vi.mocked(
			ClineAccountService.prototype.fetchRemoteConfig,
		).mockRejectedValue(new Error("offline"));

		expect(await prepareCliEnterpriseIntegration(input)).toBeUndefined();

		expect(await discoverRules()).toEqual([
			expect.stringContaining(pirateRule),
		]);
	});

	it.each([
		["blank payload", " "],
		["invalid JSON", "{"],
		["invalid schema", JSON.stringify({ version: 1 })],
	])("preserves managed rules when enabled config has %s", async (_label, value) => {
		const integration = await prepareCliEnterpriseIntegration(input);
		await integration?.dispose();
		vi.mocked(
			ClineAccountService.prototype.fetchRemoteConfig,
		).mockResolvedValue({ ...enabledResponse, value });

		expect(await prepareCliEnterpriseIntegration(input)).toBeUndefined();

		expect(await discoverRules()).toEqual([
			expect.stringContaining(pirateRule),
		]);
	});

	it("does not treat missing credentials as an authoritative disable", async () => {
		const integration = await prepareCliEnterpriseIntegration(input);
		await integration?.dispose();
		vi.mocked(
			ProviderSettingsManager.prototype.getProviderSettings,
		).mockReturnValue(undefined);
		vi.mocked(ClineAccountService.prototype.fetchRemoteConfig).mockClear();

		expect(await prepareCliEnterpriseIntegration(input)).toBeUndefined();

		expect(
			ClineAccountService.prototype.fetchRemoteConfig,
		).not.toHaveBeenCalled();
		expect(await discoverRules()).toEqual([
			expect.stringContaining(pirateRule),
		]);
	});

	it("rejects preparation when disabled instructions cannot be removed", async () => {
		const paths = await materializeEnabledConfig();
		await rm(paths.workflowsPath, { recursive: true, force: true });
		await writeFile(paths.workflowsPath, "Not a directory");
		vi.mocked(
			ClineAccountService.prototype.fetchRemoteConfig,
		).mockResolvedValue(null);
		await expect(prepareCliEnterpriseIntegration(input)).rejects.toMatchObject({
			code: "ENOTDIR",
		});
		await rm(paths.workflowsPath);
		await expect(
			prepareCliEnterpriseIntegration(input),
		).resolves.toBeUndefined();
		expect(await discoverRules()).toEqual([]);
	});

	it("does not resurrect rules from an older enabled preparation after disable", async () => {
		let releaseWrite!: () => void;
		let markWriteStarted!: () => void;
		const writeStarted = new Promise<void>((resolve) => {
			markWriteStarted = resolve;
		});
		const writeReleased = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		const writeFile = fs.writeFile.bind(fs);
		vi.spyOn(fs, "writeFile").mockImplementation(
			async (filePath, data, options) => {
				if (String(filePath).endsWith("rules.md")) {
					markWriteStarted();
					await writeReleased;
				}
				return writeFile(filePath, data, options);
			},
		);
		const enabled = prepareCliEnterpriseIntegration(input);
		await writeStarted;
		const fetchConfig = vi.mocked(
			ClineAccountService.prototype.fetchRemoteConfig,
		);
		fetchConfig.mockResolvedValue(null);
		const disabled = prepareCliEnterpriseIntegration(input);
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(fetchConfig).toHaveBeenCalledOnce();
		} finally {
			releaseWrite();
			const integration = await enabled;
			await integration?.dispose();
			await disabled;
		}
		const integration = await enabled;
		if (!integration) throw new Error("Expected enabled integration");
		for (const filePath of [
			integration.prepared.paths.rulesFilePath,
			integration.prepared.paths.manifestPath,
			integration.prepared.paths.bundleCachePath,
		]) {
			await expect(readFile(filePath)).rejects.toMatchObject({
				code: "ENOENT",
			});
		}
		expect(fetchConfig).toHaveBeenCalledTimes(2);
		expect(await discoverRules()).toEqual([]);
	});

	it("cleans the materialization root when cwd is a workspace subdirectory", async () => {
		input.config.cwd = join(workspacePath, "subdirectory");
		const integration = await prepareCliEnterpriseIntegration(input);
		await integration?.dispose();
		expect(await discoverRules()).toEqual([
			expect.stringContaining(pirateRule),
		]);
		vi.mocked(
			ClineAccountService.prototype.fetchRemoteConfig,
		).mockResolvedValue(null);

		await prepareCliEnterpriseIntegration(input);

		expect(await discoverRules()).toEqual([]);
	});
});
