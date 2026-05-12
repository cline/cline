import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { StateManager } from "@/core/storage/StateManager"
import { createProviderCatalog } from "@/sdk/model-catalog/catalog"
import type { ProviderCatalog, ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import { createProviderConfigStore } from "@/sdk/model-catalog/store"
import { Empty, StringRequest } from "@/shared/proto/cline/common"
import { CommitModelSelectionRequest } from "@/shared/proto/cline/models"
import { createStorageContext } from "@/shared/storage/storage-context"
import { commitModelSelection } from "../commitModelSelection"
import { listProviders } from "../listProviders"
import type { ProviderCatalogController } from "../providerCatalogShared"
import { readProviderConfig } from "../readProviderConfig"
import { resolveProviderModels } from "../resolveProviderModels"

vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
}))

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
		expect(Object.keys(models.models).length).toBeGreaterThanOrEqual(4)

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
				modelInfo,
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
