import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	getApiConfigurationProfileSecretKey,
	LEGACY_API_CONFIGURATION_PROFILES_SECRET_KEY,
	MAX_API_CONFIGURATION_PROFILES,
} from "@shared/api-configuration-profiles"
import { createStorageContext, type StorageContext } from "@shared/storage/storage-context"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { HostProvider } from "@/hosts/host-provider"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { StateManager } from "../StateManager"

describe("StateManager API configuration profiles", () => {
	let tempDir: string
	let storage: StorageContext
	let stateManager: StateManager

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-api-profiles-"))
		setVscodeHostProviderMock({
			globalStorageFsPath: path.join(tempDir, "global-storage"),
		})
		storage = createStorageContext({ clineDir: tempDir, workspacePath: path.join(tempDir, "workspace") })
		stateManager = await StateManager.initialize(storage)
	})

	afterEach(async () => {
		await stateManager?.flushPendingState()
		;(stateManager as any)?.dispose()
		;(StateManager as any).instance = null
		HostProvider.reset()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("stores profile metadata separately from per-profile API configuration secrets", () => {
		stateManager.setApiConfiguration({
			openAiApiKey: "secret-key",
			openAiBaseUrl: "https://api.example.com",
			actModeApiProvider: "openai",
			planModeApiProvider: "openai",
			actModeOpenAiModelId: "gpt-test",
			planModeOpenAiModelId: "gpt-test",
		})

		const profile = stateManager.saveApiConfigurationProfile("OpenAI")
		const state = storage.globalState.get<any>("apiConfigurationProfiles")
		const profileSecret = storage.secrets.get(getApiConfigurationProfileSecretKey(profile.id))

		expect(state.profiles).to.have.length(1)
		expect(state.profiles[0]).to.not.have.property("apiConfiguration")
		expect(profileSecret).to.be.a("string")
		expect(JSON.parse(profileSecret || "{}")).to.include({
			openAiApiKey: "secret-key",
			openAiBaseUrl: "https://api.example.com",
		})
	})

	it("rejects duplicate profile names", () => {
		stateManager.saveApiConfigurationProfile("Work")

		expect(() => stateManager.saveApiConfigurationProfile(" work ")).to.throw("A profile with this name already exists")
	})

	it("limits the number of saved profiles", () => {
		for (let i = 0; i < MAX_API_CONFIGURATION_PROFILES; i++) {
			stateManager.saveApiConfigurationProfile(`Profile ${i + 1}`)
		}

		expect(() => stateManager.saveApiConfigurationProfile("Too many")).to.throw(
			`You can save up to ${MAX_API_CONFIGURATION_PROFILES} API configuration profiles`,
		)
	})

	it("removes a profile's API configuration secret when deleting the profile", () => {
		const profile = stateManager.saveApiConfigurationProfile("Temporary")
		const secretKey = getApiConfigurationProfileSecretKey(profile.id)
		expect(storage.secrets.get(secretKey)).to.be.a("string")

		stateManager.deleteApiConfigurationProfile(profile.id)

		expect(storage.secrets.get(secretKey)).to.be.undefined
		expect(stateManager.getApiConfigurationProfiles()).to.deep.equal([])
	})

	it("migrates legacy inline profile configuration to per-profile secrets", () => {
		const legacyProfile = {
			id: "legacy-profile",
			name: "Legacy",
			apiProvider: "openai",
			createdAt: 1,
			updatedAt: 2,
			apiConfiguration: {
				openAiApiKey: "legacy-secret",
				openAiBaseUrl: "https://legacy.example.com",
				actModeApiProvider: "openai",
				planModeApiProvider: "openai",
			},
		}
		storage.secrets.set(
			LEGACY_API_CONFIGURATION_PROFILES_SECRET_KEY,
			JSON.stringify({ activeProfileId: legacyProfile.id, profiles: [legacyProfile] }),
		)

		const profiles = stateManager.getApiConfigurationProfiles()
		const profileSecret = storage.secrets.get(getApiConfigurationProfileSecretKey(legacyProfile.id))

		expect(profiles).to.deep.equal([
			{
				id: legacyProfile.id,
				name: legacyProfile.name,
				apiProvider: legacyProfile.apiProvider,
				createdAt: legacyProfile.createdAt,
				updatedAt: legacyProfile.updatedAt,
			},
		])
		expect(storage.secrets.get(LEGACY_API_CONFIGURATION_PROFILES_SECRET_KEY)).to.be.undefined
		expect(JSON.parse(profileSecret || "{}")).to.include({
			openAiApiKey: "legacy-secret",
			openAiBaseUrl: "https://legacy.example.com",
		})
	})
})
