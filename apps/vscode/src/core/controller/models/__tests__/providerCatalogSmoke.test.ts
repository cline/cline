import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { StateManager } from "@/core/storage/StateManager"
import { createProviderCatalog } from "@/sdk/model-catalog/catalog"
import type { ProviderCatalog, ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import { createProviderConfigStore } from "@/sdk/model-catalog/store"
import { getProviderSettingsManager } from "@/sdk/provider-migration"
import { Empty, StringRequest } from "@/shared/proto/cline/common"
import {
	CommitModelSelectionRequest,
	CreateOpenAiCompatibleProviderRequest,
	WriteProviderConfigRequest,
} from "@/shared/proto/cline/models"
import { createStorageContext } from "@/shared/storage/storage-context"
import { commitModelSelection } from "../commitModelSelection"
import { createOpenAiCompatibleProvider } from "../createOpenAiCompatibleProvider"
import { deleteOpenAiCompatibleProvider } from "../deleteOpenAiCompatibleProvider"
import { listProviders } from "../listProviders"
import type { ProviderCatalogController } from "../providerCatalogShared"
import { readProviderConfig } from "../readProviderConfig"
import { resolveProviderModels } from "../resolveProviderModels"
import { writeProviderConfig } from "../writeProviderConfig"

vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
}))

vi.mock("@/core/controller/grpc-handler", () => ({ getRequestRegistry: vi.fn() }))

describe("provider model catalog backend smoke", () => {
	let clineDir: string
	let store: ProviderConfigStore
	let catalog: ProviderCatalog
	let controller: ProviderCatalogController
	let originalClineDir: string | undefined

	beforeAll(async () => {
		clineDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-provider-catalog-smoke-"))
		originalClineDir = process.env.CLINE_DIR
		process.env.CLINE_DIR = clineDir
		await StateManager.initialize(createStorageContext({ clineDir, workspacePath: clineDir }))
		store = createProviderConfigStore()
		catalog = createProviderCatalog(store)
		controller = {
			getProviderConfigStore: () => store,
			getProviderCatalog: () => catalog,
		}
	})

	afterAll(async () => {
		await StateManager.get().flushPendingState()
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR
		} else {
			process.env.CLINE_DIR = originalClineDir
		}
		await StateManager.get().reInitialize()
		await fs.rm(clineDir, { recursive: true, force: true })
	})

	it("creates named providers with isolated configuration and persists their catalog entries", async () => {
		const first = await createOpenAiCompatibleProvider(
			controller,
			CreateOpenAiCompatibleProviderRequest.create({ name: "Work server", baseUrl: "https://work.example/v1" }),
		)
		const second = await createOpenAiCompatibleProvider(
			controller,
			CreateOpenAiCompatibleProviderRequest.create({ name: "Local server", baseUrl: "http://localhost:1234/v1" }),
		)
		expect(first.id).not.toBe(second.id)
		await writeProviderConfig(
			controller,
			WriteProviderConfigRequest.create({ providerId: first.id, patch: { apiKey: "SECRET-work" } }),
		)
		const firstConfig = await readProviderConfig(controller, StringRequest.create({ value: first.id }))
		const secondConfig = await readProviderConfig(controller, StringRequest.create({ value: second.id }))
		expect(firstConfig.apiKeyLength).toBe(11)
		expect(firstConfig.baseUrl).toBe("https://work.example/v1")
		expect(secondConfig.baseUrl).toBe("http://localhost:1234/v1")
		expect(secondConfig.apiKeyLength).toBe(0)
		expect(JSON.stringify(firstConfig)).not.toContain("SECRET-work")
		await commitModelSelection(
			controller,
			CommitModelSelectionRequest.create({ providerId: first.id, mode: "act", modelId: "gemini-4-argon" }),
		)
		const saved = await readProviderConfig(controller, StringRequest.create({ value: first.id }))
		expect(saved.actSelection?.modelId).toBe("gemini-4-argon")
		expect((await readProviderConfig(controller, StringRequest.create({ value: second.id }))).actSelection).toBeUndefined()
		const reloaded = createProviderCatalog(createProviderConfigStore())
		expect(
			(await reloaded.listProviders())
				.filter((provider) => [first.id, second.id].includes(provider.id))
				.map((provider) => provider.name)
				.sort(),
		).toEqual(["Local server", "Work server"])
		await expect(
			createOpenAiCompatibleProvider(
				controller,
				CreateOpenAiCompatibleProviderRequest.create({ name: "work server", baseUrl: "https://other.example/v1" }),
			),
		).rejects.toThrow("already exists")
		for (const request of [
			{ name: " ", baseUrl: "https://example.com" },
			{ name: "Invalid", baseUrl: "file:///tmp" },
		]) {
			await expect(
				createOpenAiCompatibleProvider(controller, CreateOpenAiCompatibleProviderRequest.create(request)),
			).rejects.toThrow()
		}
	})

	it("deletes a custom provider, saved secrets and catalog entry while preserving other providers", async () => {
		const added = await createOpenAiCompatibleProvider(
			controller,
			CreateOpenAiCompatibleProviderRequest.create({ name: "Delete me", baseUrl: "https://delete.example/v1" }),
		)
		await writeProviderConfig(
			controller,
			WriteProviderConfigRequest.create({ providerId: added.id, patch: { apiKey: "delete-this-secret" } }),
		)
		await deleteOpenAiCompatibleProvider(controller, StringRequest.create({ value: added.id }))
		expect((await catalog.listProviders()).some((entry) => entry.id === added.id)).toBe(false)
		expect(getProviderSettingsManager().getProviderSettings(added.id)).toBeUndefined()
		expect((await catalog.listProviders()).some((entry) => entry.id === "deepseek")).toBe(true)
		await expect(deleteOpenAiCompatibleProvider(controller, StringRequest.create({ value: "openai" }))).rejects.toThrow(
			"Only custom",
		)
	})

	it("lists providers, resolves DeepSeek models, and round-trips committed selection", async () => {
		const providers = await listProviders(controller, Empty.create())
		expect(providers.providers.length).toBeGreaterThanOrEqual(4)
		expect(providers.providers.some((provider) => provider.id === "deepseek")).toBe(true)

		const models = await resolveProviderModels(controller, {
			providerId: "deepseek",
			forceRefresh: false,
			requestId: "smoke-request",
		})
		expect(models.ok).toBe(true)
		expect(models.requestId).toBe("smoke-request")
		// Don't pin an exact count: the generated catalog is refreshed regularly
		// and DeepSeek's lineup changes (e.g. the v4 refresh shrank it to 3).
		expect(Object.keys(models.models).length).toBeGreaterThan(0)

		const modelId = models.defaultModelId || Object.keys(models.models)[0]
		expect(modelId).toBeTruthy()
		const modelInfo = models.models[modelId]
		expect(modelInfo).toBeDefined()

		await commitModelSelection(
			controller,
			CommitModelSelectionRequest.create({
				providerId: "deepseek",
				mode: "act",
				modelId,
			}),
		)

		const config = await readProviderConfig(controller, StringRequest.create({ value: "deepseek" }))
		expect(config.providerId).toBe("deepseek")
		expect(config.actSelection?.providerId).toBe("deepseek")
		expect(config.actSelection?.modelId).toBe(modelId)
		expect(config.actSelection?.modelInfo).toEqual(modelInfo)
		expect(JSON.stringify(config)).not.toContain("SECRET")
	})
})
