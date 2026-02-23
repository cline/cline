/**
 * Tests for BannerService
 * Tests API fetching, caching, auth updates, and rate limit backoff
 */

import type { BannerRules } from "@shared/ClineBanner"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import { ClineEnv, Environment } from "@/config"
import { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { HostRegistryInfo } from "@/registry"
import { AuthService } from "@/services/auth/AuthService"
import { getFeatureFlagsService } from "@/services/feature-flags"
import { mockFetchForTesting } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { BannerService } from "../BannerService"

describe("BannerService", () => {
	let sandbox: sinon.SinonSandbox
	let mockFetch: sinon.SinonStub
	let token: string | null = "fake-token"

	// Default mock state manager configuration
	let mockStateManagerConfig: {
		apiConfiguration: Record<string, unknown>
		mode: string | undefined
		dismissedBanners: Array<{ bannerId: string; dismissedAt: number }>
	}

	let mockedPostStateToWebview: sinon.SinonStub
	let mockController: Controller

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		mockedPostStateToWebview = sandbox.stub().resolves(undefined)
		mockController = {
			postStateToWebview: mockedPostStateToWebview,
		} as any

		sandbox.stub(Logger, "log")
		sandbox.stub(Logger, "error")

		// Mock feature flag service to enable remote banners
		sandbox.stub(getFeatureFlagsService(), "getBooleanFlagEnabled").returns(true)

		// Default state manager configuration
		mockStateManagerConfig = {
			apiConfiguration: {},
			mode: undefined,
			dismissedBanners: [],
		}

		// Mock StateManager.get() to return our mock
		sandbox.stub(StateManager, "get").returns({
			getApiConfiguration: () => mockStateManagerConfig.apiConfiguration,
			getGlobalSettingsKey: (key: string) => (key === "mode" ? mockStateManagerConfig.mode : undefined),
			getGlobalStateKey: (key: string) => (key === "dismissedBanners" ? mockStateManagerConfig.dismissedBanners : []),
			setGlobalState: (key: string, value: unknown) => {
				if (key === "dismissedBanners") {
					mockStateManagerConfig.dismissedBanners = value as Array<{ bannerId: string; dismissedAt: number }>
				}
			},
		} as unknown as StateManager)

		// Mock HostRegistryInfo.get() to return mock host info
		sandbox.stub(HostRegistryInfo, "get").returns({
			extensionVersion: "1.0.0",
			platform: "darwin",
			os: "darwin",
			ide: "vscode",
			distinctId: "test-distinct-id",
		})

		// Mock ClineEnv.config() to return a valid config
		sandbox.stub(ClineEnv, "config").returns({
			environment: Environment.production,
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		})

		const authService = AuthService.getInstance()
		token = "fake-token"
		sandbox.replace(authService, "getAuthToken", () => Promise.resolve(token))

		// Create mock fetch
		mockFetch = sandbox.stub()

		// Reset singleton
		BannerService.reset()
	})

	afterEach(() => {
		BannerService.reset()
		sandbox.restore()
	})

	// Helper to create a successful fetch response
	function createSuccessResponse(data: unknown) {
		return {
			ok: true,
			status: 200,
			json: async () => data,
		}
	}

	// Helper to create an error fetch response
	function createErrorResponse(status: number) {
		return {
			ok: false,
			status,
			json: async () => ({}),
		}
	}

	describe("API Fetching", () => {
		it("should fetch banners from API successfully", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_test1",
							titleMd: "Test Banner",
							bodyMd: "This is a test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners() // Triggers background fetch

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(mockFetch.calledOnce).to.be.true
				const banners = bannerService.getActiveBanners() // Get banners after fetch completes
				expect(banners).to.have.lengthOf(1)
				expect(banners[0].id).to.equal("bnr_test1")
				expect(banners[0].title).to.equal("Test Banner")
				expect(banners[0].description).to.equal("This is a test")
			})
		})

		it("should handle API errors gracefully", async () => {
			mockFetch.rejects(new Error("Network error"))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				const banners = bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(banners).to.have.lengthOf(0)
			})
		})

		it("should cache banners for 24 hours", async () => {
			const clock = sandbox.useFakeTimers(Date.now())

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_cached",
							titleMd: "Cached Banner",
							bodyMd: "Test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)

				// Trigger initial fetch by calling getActiveBanners (fires background fetch)
				bannerService.getActiveBanners()
				// Wait for the background fetch to complete
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(1)

				// Second call within cache window uses cache (no new API call)
				bannerService.getActiveBanners()
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(1)

				// After 1 hour, still uses cache
				await clock.tickAsync(60 * 60 * 1000)
				bannerService.getActiveBanners()
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(1)

				// After 23 hours total, still uses cache
				await clock.tickAsync(22 * 60 * 60 * 1000)
				bannerService.getActiveBanners()
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(1)

				// After 25 hours total, cache expired, triggers new background fetch
				await clock.tickAsync(2 * 60 * 60 * 1000)
				bannerService.getActiveBanners()
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(2)
			})

			clock.restore()
		})
	})

	describe("API Provider Rule Evaluation (Client-Side)", () => {
		it("should show banner when user has selected the required API provider in act mode", async () => {
			mockStateManagerConfig.apiConfiguration = { actModeApiProvider: "openai" }
			mockStateManagerConfig.mode = "act"

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_openai",
							titleMd: "OpenAI Users",
							bodyMd: "For OpenAI API",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: JSON.stringify({ providers: ["openai"] } as BannerRules),
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(1)
				expect(banners[0].id).to.equal("bnr_openai")
			})
		})

		it("should show banner when user has selected the required API provider in plan mode", async () => {
			mockStateManagerConfig.apiConfiguration = { planModeApiProvider: "anthropic" }
			mockStateManagerConfig.mode = "plan"

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_anthropic",
							titleMd: "Anthropic Users",
							bodyMd: "For Anthropic API",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: JSON.stringify({ providers: ["anthropic"] } as BannerRules),
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(1)
				expect(banners[0].id).to.equal("bnr_anthropic")
			})
		})

		it("should NOT show banner when user has selected a different API provider", async () => {
			mockStateManagerConfig.apiConfiguration = { actModeApiProvider: "anthropic" }
			mockStateManagerConfig.mode = "act"

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_openai",
							titleMd: "OpenAI Users",
							bodyMd: "For OpenAI API",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: JSON.stringify({ providers: ["openai"] } as BannerRules),
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(0)
			})
		})

		it("should show banner if user has selected ANY of multiple specified providers", async () => {
			mockStateManagerConfig.apiConfiguration = { actModeApiProvider: "anthropic" }
			mockStateManagerConfig.mode = "act"

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_multi",
							titleMd: "Multiple Providers",
							bodyMd: "For Anthropic or OpenAI users",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: JSON.stringify({ providers: ["anthropic", "openai"] } as BannerRules),
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(1)
				expect(banners[0].id).to.equal("bnr_multi")
			})
		})

		it("should NOT show banner when no provider is selected", async () => {
			mockStateManagerConfig.apiConfiguration = {}
			mockStateManagerConfig.mode = "act"

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_openai",
							titleMd: "OpenAI Users",
							bodyMd: "For OpenAI API",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: JSON.stringify({ providers: ["openai"] } as BannerRules),
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(0)
			})
		})
	})

	describe("Invalid or No Banner Rules", () => {
		it("should handle malformed rules gracefully (fail open)", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_malformed",
							titleMd: "Malformed",
							bodyMd: "Test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{ invalid json",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(1)
			})
		})

		it("should handle banners with no rules", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_norules",
							titleMd: "No Rules",
							bodyMd: "Test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(1)
				expect(banners[0].id).to.equal("bnr_norules")
			})
		})
	})

	describe("Cache Management", () => {
		it("should clear cache when requested", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_test",
							titleMd: "Test",
							bodyMd: "Test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))
				expect(mockFetch.calledOnce).to.be.true

				bannerService.clearCache()

				bannerService.getActiveBanners()
				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))
				expect(mockFetch.calledTwice).to.be.true
			})
		})
	})

	describe("OS Parameter Integration", () => {
		it("should send OS parameter in API request", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_test",
							titleMd: "Test Banner",
							bodyMd: "This is a test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(mockFetch.calledOnce).to.be.true
				const call = mockFetch.getCall(0)
				const url = call.args[0]
				expect(url).to.include("os=")
			})
		})
	})

	describe("Banner to BannerCardData Conversion", () => {
		it("should convert banner with valid action types", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_valid_actions",
							titleMd: "Valid Actions Banner",
							bodyMd: "Has valid actions",
							icon: "lightbulb",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
							actions: [
								{ title: "Link", action: "link", arg: "https://example.com" },
								{ title: "Settings", action: "show-api-settings" },
							],
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(1)
				expect(banners[0].id).to.equal("bnr_valid_actions")
				expect(banners[0].title).to.equal("Valid Actions Banner")
				expect(banners[0].description).to.equal("Has valid actions")
				expect(banners[0].icon).to.equal("lightbulb")
				expect(banners[0].actions).to.have.lengthOf(2)
				expect(banners[0].actions![0].title).to.equal("Link")
				expect(banners[0].actions![0].action).to.equal("link")
				expect(banners[0].actions![0].arg).to.equal("https://example.com")
				expect(banners[0].actions![1].title).to.equal("Settings")
				expect(banners[0].actions![1].action).to.equal("show-api-settings")
			})
		})

		it("should drop banner with invalid action type and log error", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_invalid_action",
							titleMd: "Invalid Action Banner",
							bodyMd: "Has invalid action type",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
							actions: [{ title: "Invalid", action: "unknown-action-type", arg: "test" }],
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(0)
			})
		})

		it("should keep valid banners and drop only invalid ones", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_valid",
							titleMd: "Valid Banner",
							bodyMd: "This one is valid",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
							actions: [{ title: "Link", action: "link", arg: "https://example.com" }],
						},
						{
							id: "bnr_invalid",
							titleMd: "Invalid Banner",
							bodyMd: "This one has invalid action",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
							actions: [{ title: "Bad", action: "not-a-real-action" }],
						},
						{
							id: "bnr_also_valid",
							titleMd: "Also Valid Banner",
							bodyMd: "This one is also valid",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(2)
				expect(banners[0].id).to.equal("bnr_valid")
				expect(banners[1].id).to.equal("bnr_also_valid")
			})
		})

		it("should convert banner with no actions", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_no_actions",
							titleMd: "No Actions Banner",
							bodyMd: "Has no actions",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(1)
				expect(banners[0].id).to.equal("bnr_no_actions")
				expect(banners[0].actions).to.have.lengthOf(0)
			})
		})

		it("should convert banner with empty actions array", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_empty_actions",
							titleMd: "Empty Actions Banner",
							bodyMd: "Has empty actions array",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
							actions: [],
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(1)
				expect(banners[0].id).to.equal("bnr_empty_actions")
				expect(banners[0].actions).to.have.lengthOf(0)
			})
		})

		it("should drop banner when action has undefined action type", async () => {
			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_undefined_action",
							titleMd: "Undefined Action Type",
							bodyMd: "Action has no type defined",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
							actions: [{ title: "Just a label" }],
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(banners).to.have.lengthOf(0)
			})
		})

		it("should accept all valid BannerActionType values", async () => {
			const validActionTypes = [
				"link",
				"show-api-settings",
				"show-feature-settings",
				"show-account",
				"set-model",
				"install-cli",
			]

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_all_valid_types",
							titleMd: "All Valid Types",
							bodyMd: "Has all valid action types",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
							actions: validActionTypes.map((type, index) => ({
								title: `Action ${index}`,
								action: type,
							})),
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				const banners = bannerService.getActiveBanners()
				expect(mockedPostStateToWebview.called).to.be.true
				expect(banners).to.have.lengthOf(1)
				expect(banners[0].actions).to.have.lengthOf(validActionTypes.length)
				banners[0].actions!.forEach((action, index) => {
					expect(action.action).to.equal(validActionTypes[index])
				})
			})
		})
	})

	describe("IDE Type Detection", () => {
		function stubHostInfo(overrides: { ide?: string; platform?: string }) {
			;(HostRegistryInfo.get as sinon.SinonStub).returns({
				extensionVersion: "1.0.0",
				platform: overrides.platform ?? "darwin",
				os: "darwin",
				ide: overrides.ide ?? "vscode",
				distinctId: "test-distinct-id",
			})
		}

		async function getIdeParam(fetch: sinon.SinonStub): Promise<string> {
			const url = new URL(fetch.getCall(fetch.callCount - 1).args[0])
			return url.searchParams.get("ide") ?? ""
		}

		const emptyResponse = { data: { items: [] } }

		it('should return "vscode" when ide contains "vscode"', async () => {
			stubHostInfo({ ide: "vscode" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("vscode")
			})
		})

		it('should return "vscode" when ide is "VSCode Extension" (case-insensitive)', async () => {
			stubHostInfo({ ide: "VSCode Extension" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("vscode")
			})
		})

		it('should return "jetbrains" when ide contains "jetbrains"', async () => {
			stubHostInfo({ ide: "jetbrains" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("jetbrains")
			})
		})

		it('should return "jetbrains" when ide is "Cline for JetBrains" (case-insensitive)', async () => {
			stubHostInfo({ ide: "Cline for JetBrains" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("jetbrains")
			})
		})

		it('should return "cli" when ide contains "cli"', async () => {
			stubHostInfo({ ide: "cli" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("cli")
			})
		})

		it('should fall back to "vscode" when ide is empty but platform contains "Visual Studio"', async () => {
			stubHostInfo({ ide: "", platform: "Visual Studio Code 1.103.0" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("vscode")
			})
		})

		it('should fall back to "vscode" when ide is empty but platform contains "vscode"', async () => {
			stubHostInfo({ ide: "", platform: "vscode" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("vscode")
			})
		})

		it('should return "unknown" when both ide and platform are unrecognized', async () => {
			stubHostInfo({ ide: "some-random-ide", platform: "some-random-platform" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("unknown")
			})
		})

		it('should return "unknown" when both ide and platform are empty', async () => {
			stubHostInfo({ ide: "", platform: "" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("unknown")
			})
		})

		it("should prefer ide field over platform field for detection", async () => {
			stubHostInfo({ ide: "Cline for JetBrains", platform: "Visual Studio Code 1.103.0" })
			mockFetch.resolves(createSuccessResponse(emptyResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()
				await new Promise((resolve) => setTimeout(resolve, 10))

				expect(await getIdeParam(mockFetch)).to.equal("jetbrains")
			})
		})
	})

	describe("Rate Limit Backoff (429)", () => {
		it("should trigger backoff on 429 response and return cached banners during backoff", async () => {
			const clock = sandbox.useFakeTimers(Date.now())

			// First, cache a banner
			const successResponse = {
				data: {
					items: [
						{
							id: "bnr_cached",
							titleMd: "Cached Banner",
							bodyMd: "This is cached",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(successResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(1)

				// Expire cache
				await clock.tickAsync(25 * 60 * 60 * 1000)

				// Simulate 429 error
				mockFetch.resolves(createErrorResponse(429))

				// This call triggers 429
				bannerService.getActiveBanners()
				await clock.tickAsync(0)

				const banners1 = bannerService.getActiveBanners()
				expect(banners1).to.have.lengthOf(1) // Returns cached
				expect(mockFetch.callCount).to.equal(2)
			})

			clock.restore()
		})
	})

	describe("onAuthUpdate", () => {
		it("should update the user id and trigger fetch after debounce", async () => {
			const clock = sandbox.useFakeTimers(Date.now())

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_test",
							titleMd: "Test Banner",
							bodyMd: "Test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				// Initialize the service
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(1)

				// Call onAuthUpdate with a new token
				const authPromise = BannerService.onAuthUpdate("new-user-id")
				await clock.tickAsync(1000) // Advance past debounce (AUTH_DEBOUNCE_MS)
				await authPromise

				// Should have triggered a new fetch
				expect(mockFetch.callCount).to.equal(2)

				// Verify the auth header was included
				const lastCall = mockFetch.getCall(1)
				const options = lastCall.args[1]
				expect(options.headers.Authorization).to.equal(`Bearer ${token}`)
			})

			clock.restore()
		})

		it("should clear pending retry timeout on auth update", async () => {
			const clock = sandbox.useFakeTimers(Date.now())

			const successResponse = {
				data: {
					items: [
						{
							id: "bnr_test",
							titleMd: "Test",
							bodyMd: "Test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(successResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(1)

				// Expire cache and trigger a rate limit
				await clock.tickAsync(25 * 60 * 60 * 1000)
				mockFetch.resolves(createErrorResponse(429))
				bannerService.getActiveBanners()
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(2)

				// Now update auth - should clear the retry timeout
				// Note: onAuthUpdate has 1000ms debounce (AUTH_DEBOUNCE_MS), so we need to advance the clock
				mockFetch.resolves(createSuccessResponse(successResponse))
				const authPromise = BannerService.onAuthUpdate("user-id")
				await clock.tickAsync(1000) // Advance past debounce
				await authPromise

				expect(mockFetch.callCount).to.equal(3)

				// The scheduled retry (1 hour later) should have been cancelled
				// If we advance time, there shouldn't be another fetch from the old retry
				await clock.tickAsync(2 * 60 * 60 * 1000) // 2 hours
				expect(mockFetch.callCount).to.equal(3) // No additional fetch from old retry
			})

			clock.restore()
		})

		it("should handle auth update when service is not initialized", async () => {
			// Ensure service is not initialized
			BannerService.reset()

			// This should not throw (onAuthUpdate will initialize the service)
			let error: Error | null = null
			try {
				await BannerService.onAuthUpdate("user-id")
			} catch (e) {
				error = e as Error
			}
			expect(error).to.be.null
		})

		it("should handle null user-id (logout)", async () => {
			const clock = sandbox.useFakeTimers(Date.now())

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_test",
							titleMd: "Test",
							bodyMd: "Test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(1)

				// Set a user id first
				const authPromise1 = BannerService.onAuthUpdate("usr-id")
				await clock.tickAsync(1000) // Advance past debounce
				await authPromise1
				expect(mockFetch.callCount).to.equal(2)

				// Now logout (null user id)
				token = null
				const authPromise2 = BannerService.onAuthUpdate(null)
				await clock.tickAsync(1000) // Advance past debounce
				await authPromise2
				expect(mockFetch.callCount).to.equal(3)

				// Verify no auth header on last call
				const lastCall = mockFetch.getCall(2)
				const options = lastCall.args[1]
				expect(options.headers.Authorization).to.be.undefined
			})

			clock.restore()
		})

		it("should debounce rapid auth updates", async () => {
			const clock = sandbox.useFakeTimers(Date.now())

			const mockResponse = {
				data: {
					items: [
						{
							id: "bnr_test",
							titleMd: "Test Banner",
							bodyMd: "Test",
							severity: "info" as const,
							placement: "top" as const,
							rulesJson: "{}",
						},
					],
				},
			}

			mockFetch.resolves(createSuccessResponse(mockResponse))

			await mockFetchForTesting(mockFetch, async () => {
				// Initialize the service
				const bannerService = BannerService.initialize(mockController)
				bannerService.getActiveBanners()

				// Wait for background fetch to complete
				await clock.tickAsync(0)
				expect(mockFetch.callCount).to.equal(1)

				const updatedToken = "test-updated-token"
				token = updatedToken

				// Simulate rapid auth updates during startup (common scenario)
				const promise1 = BannerService.onAuthUpdate("usr-1")
				const promise2 = BannerService.onAuthUpdate("usr-2")
				const promise3 = BannerService.onAuthUpdate("usr-3")

				// Advance past debounce period and allow async callback to complete
				// The debounce timer fires at 1000ms (AUTH_DEBOUNCE_MS), then we need additional ticks for the async fetch
				await clock.tickAsync(1000)
				await clock.tickAsync(0) // Allow microtasks/promises from the debounce callback to settle

				// Wait for all promises to resolve
				await Promise.all([promise1, promise2, promise3])

				// Should only have made ONE additional fetch (debounced), not three
				expect(mockFetch.callCount).to.equal(2)

				// Verify the token was used
				const lastCall = mockFetch.getCall(1)
				const options = lastCall.args[1]
				expect(options.headers.Authorization).to.equal(`Bearer ${updatedToken}`)
			})

			clock.restore()
		})
	})
})
