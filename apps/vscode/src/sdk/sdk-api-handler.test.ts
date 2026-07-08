import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildApiHandler, buildSdkProviderConfig } from "./sdk-api-handler"

const mocks = vi.hoisted(() => {
	const providerSettingsManager = {
		getProviderSettings: vi.fn(),
	}
	return {
		buildClineRequestMetadata: vi.fn(async () => ({
			userAgent: "Cline/test",
			clientName: "VSCode Extension",
			clientVersion: "1.2.3",
			platform: "Visual Studio Code",
			platformVersion: "1.90.0",
			coreVersion: "1.2.3",
			isMultiRoot: false,
		})),
		createHandler: vi.fn((config: { modelId?: string }) => ({
			createMessage: vi.fn(),
			getModel: vi.fn(() => ({
				id: config.modelId ?? "",
				info: {},
			})),
		})),
		getProviderSettingsManager: vi.fn(() => providerSettingsManager),
		providerSettingsManager,
	}
})

vi.mock("@/services/EnvUtils", () => ({
	buildClineRequestMetadata: mocks.buildClineRequestMetadata,
}))

vi.mock("@cline/llms", async () => {
	const actual = await vi.importActual<typeof import("@cline/llms")>("@cline/llms")
	return {
		...actual,
		createHandler: mocks.createHandler,
	}
})

vi.mock("./provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		warn: vi.fn(),
	},
}))

describe("buildSdkProviderConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("uses shared Cline OAuth credentials for ClinePass direct handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "cline") {
				return undefined
			}
			return {
				provider: "cline",
				auth: {
					accessToken: "workos:shared-cline-token",
					refreshToken: "refresh-token",
				},
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "cline-pass",
				actModeClinePassModelId: "cline-pass/glm-5.1",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "cline-pass",
			modelId: "cline-pass/glm-5.1",
			apiKey: "workos:shared-cline-token",
		})
		expect(mocks.providerSettingsManager.getProviderSettings).toHaveBeenCalledWith("cline")
	})

	it("uses provider-specific settings for SDK-backed direct handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "v0") {
				return undefined
			}
			return {
				provider: "v0",
				apiKey: "v0-key",
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "v0",
				actModeApiModelId: "v0-1.5-md",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "v0",
			modelId: "v0-1.5-md",
			apiKey: "v0-key",
		})
		expect(mocks.providerSettingsManager.getProviderSettings).toHaveBeenCalledWith("v0")
	})

	it("threads VS Code request metadata into standalone Cline handlers", async () => {
		const handler = await buildApiHandler(
			{
				actModeApiProvider: "cline",
				actModeClineModelId: "anthropic/claude-sonnet-4.6",
				clineApiKey: "test-key",
			},
			"act",
			{ disableReasoning: true },
		)

		expect(mocks.buildClineRequestMetadata).toHaveBeenCalledTimes(1)
		expect(mocks.createHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "cline",
				extensionContext: expect.objectContaining({
					client: {
						name: "cline-vscode",
						version: "1.2.3",
					},
					requestMetadata: {
						clientType: "VSCode Extension",
						clientVersion: "1.2.3",
						userAgent: "Cline/test",
						platform: "Visual Studio Code",
						platformVersion: "1.90.0",
						coreVersion: "1.2.3",
						isMultiRoot: false,
					},
				}),
			}),
		)
		expect((handler.getModel() as { providerId?: string }).providerId).toBe("cline")
	})
})
