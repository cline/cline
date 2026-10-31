import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { ApiConfiguration } from "@shared/api"
import { UpdateApiConfigurationRequest } from "@shared/proto/cline/models"
import { convertApiConfigurationToProto } from "@shared/proto-conversions/models/api-configuration-conversion"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Controller } from "@/core/controller"
import { updateApiConfigurationProto } from "@/core/controller/models/updateApiConfigurationProto"
import { StateManager } from "@/core/storage/StateManager"
import { readGlobalStateFromStorage } from "@/core/storage/utils/state-helpers"
import { createStorageContext } from "@/shared/storage/storage-context"
import { buildBedrockProviderConfig } from "./bedrock-config"
import { parseProviderId } from "./model-catalog/provider-id"
import { createProviderConfigStore } from "./model-catalog/store"
import { getProviderSettingsManager } from "./provider-migration"

vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
}))

// Use the real file-backed provider manager as well as StateManager: a stale
// provider-wide base must not overwrite either mode during migration or reload.
vi.mock("@cline/core", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	ProviderSettingsManager: (await import("../../../../sdk/packages/core/dist/index.js")).ProviderSettingsManager,
}))

describe("Bedrock mode-specific base model persistence (#15200)", () => {
	const bedrock = parseProviderId("bedrock")
	const planBase = "anthropic.claude-opus-4-6-v1"
	const actBase = "anthropic.claude-sonnet-4-6"
	let clineDir: string
	let dataDir: string
	let stateManager: StateManager

	const updateConfiguration = async (patch: Partial<ApiConfiguration>) => {
		await updateApiConfigurationProto(
			{
				stateManager,
				getProviderConfigStore: createProviderConfigStore,
				handleApiConfigurationChanged: vi.fn(),
				postStateToWebview: vi.fn(async () => undefined),
			} as unknown as Controller,
			UpdateApiConfigurationRequest.create({
				apiConfiguration: convertApiConfigurationToProto({ ...stateManager.getApiConfiguration(), ...patch }),
			}),
		)
	}

	const reloadConfiguration = async () => {
		await stateManager.flushPendingState()
		await stateManager.reInitialize()
		stateManager = StateManager.get()
		// Construction also exercises the SDK's legacy-provider migration on reload.
		const { ProviderSettingsManager } = await import("@cline/core")
		new ProviderSettingsManager({ filePath: path.join(dataDir, "settings", "providers.json"), dataDir })
		// A fresh storage context reads disk rather than reusing ClineFileStorage's
		// in-memory cache, then runs the same hydration reader as StateManager.
		return readGlobalStateFromStorage(createStorageContext({ clineDir, workspacePath: clineDir }).globalState)
	}

	beforeAll(async () => {
		clineDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-bedrock-mode-base-"))
		dataDir = path.join(clineDir, "data")
		vi.stubEnv("CLINE_DATA_DIR", dataDir)
		await StateManager.initialize(createStorageContext({ clineDir, workspacePath: clineDir }))
		stateManager = StateManager.get()
	})

	beforeEach(async () => {
		stateManager.setGlobalState("planActSeparateModelsSetting", true)
		stateManager.setApiConfiguration({
			planModeApiProvider: "bedrock",
			actModeApiProvider: "bedrock",
			planModeApiModelId: "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/plan",
			actModeApiModelId: "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/act",
			planModeAwsBedrockCustomModelBaseId: "",
			actModeAwsBedrockCustomModelBaseId: "",
		})
		getProviderSettingsManager().saveProviderSettings({
			provider: "bedrock",
			aws: { customModelBaseId: actBase },
		})
	})

	afterAll(async () => {
		await stateManager.flushPendingState()
		await stateManager.reInitialize()
		vi.unstubAllEnvs()
		await fs.rm(clineDir, { recursive: true, force: true })
	})

	it("keeps Plan A and Act B through RPC saves, shared-field writes, and disk reload", async () => {
		await updateConfiguration({ planModeAwsBedrockCustomModelBaseId: planBase })
		await updateConfiguration({ actModeAwsBedrockCustomModelBaseId: actBase })
		const store = createProviderConfigStore()
		expect(store.read(bedrock).aws?.customModelBaseId).toBe(actBase)
		store.write(bedrock, { region: "us-east-1", aws: { usePromptCache: true } })
		const configuration = await reloadConfiguration()
		const persisted = JSON.parse(await fs.readFile(path.join(dataDir, "globalState.json"), "utf8"))
		for (const config of [configuration, persisted]) {
			expect(config.planModeAwsBedrockCustomModelBaseId).toBe(planBase)
			expect(config.actModeAwsBedrockCustomModelBaseId).toBe(actBase)
		}
		expect(buildBedrockProviderConfig(configuration, "plan").aws?.customModelBaseId).toBe(planBase)
		expect(buildBedrockProviderConfig(configuration, "act").aws?.customModelBaseId).toBe(actBase)
	})

	it("clears only the active mode for a catalog model and preserves that after reload", async () => {
		await updateConfiguration({ planModeAwsBedrockCustomModelBaseId: planBase, actModeAwsBedrockCustomModelBaseId: actBase })
		await updateConfiguration({ planModeAwsBedrockCustomModelBaseId: "" })
		const configuration = await reloadConfiguration()
		expect(configuration.planModeAwsBedrockCustomModelBaseId).toBe("")
		expect(configuration.actModeAwsBedrockCustomModelBaseId).toBe(actBase)
		expect(buildBedrockProviderConfig(configuration, "plan").aws?.customModelBaseId).toBeUndefined()
		expect(buildBedrockProviderConfig(configuration, "act").aws?.customModelBaseId).toBe(actBase)
	})

	it("persists both fields when shared-mode settings update them together", async () => {
		stateManager.setGlobalState("planActSeparateModelsSetting", false)
		await updateConfiguration({ planModeAwsBedrockCustomModelBaseId: planBase, actModeAwsBedrockCustomModelBaseId: planBase })
		const configuration = await reloadConfiguration()
		expect(configuration.planModeAwsBedrockCustomModelBaseId).toBe(planBase)
		expect(configuration.actModeAwsBedrockCustomModelBaseId).toBe(planBase)
	})
})
