import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	constructor: vi.fn(),
	identity: vi.fn(),
	baseUrl: "https://one.test",
	fetch: vi.fn(),
}))
vi.mock("@cline/core", () => ({
	ProviderSettingsManager: class {
		constructor(options: unknown) {
			mocks.constructor(options)
		}
	},
}))
vi.mock("@/config", () => ({ ClineEnv: { config: () => ({ apiBaseUrl: mocks.baseUrl }) } }))
vi.mock("@/services/ClineClientIdentity", () => ({ resolveClineClientIdentity: mocks.identity }))
vi.mock("@/shared/net", () => ({ fetch: mocks.fetch }))
vi.mock("./provider-migration", () => ({ getProviderSettingsManager: () => ({ getFilePath: () => "/test/providers.json" }) }))

import { getModelProviderSettingsManager } from "./model-provider-settings"

beforeEach(() => {
	mocks.constructor.mockClear()
})
describe("model provider settings", () => {
	it("waits for host identity and injects the proxy transport before constructing the manager", async () => {
		let release!: (value: { name: string; version: string }) => void
		mocks.identity.mockReturnValue(
			new Promise((resolve) => {
				release = resolve
			}),
		)
		const pending = getModelProviderSettingsManager()
		expect(mocks.constructor).not.toHaveBeenCalled()
		release({ name: "JetBrains", version: "1.2.3" })
		await pending
		expect(mocks.constructor).toHaveBeenCalledWith({
			filePath: "/test/providers.json",
			baseUrl: "https://one.test",
			client: { name: "JetBrains", version: "1.2.3" },
			fetchImpl: mocks.fetch,
		})
	})
	it("reuses managers only while endpoint and identity match", async () => {
		mocks.identity.mockResolvedValue({ name: "VSCode Extension", isMultiRoot: false })
		const first = await getModelProviderSettingsManager()
		expect(await getModelProviderSettingsManager()).toBe(first)
		mocks.identity.mockResolvedValue({ name: "VSCode Extension", isMultiRoot: true })
		const multiRoot = await getModelProviderSettingsManager()
		expect(multiRoot).not.toBe(first)
		mocks.baseUrl = "https://two.test"
		expect(await getModelProviderSettingsManager()).not.toBe(multiRoot)
	})
})
