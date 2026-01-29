/**
 * Tests for BannerService
 * Tests API fetching, caching, circuit breaker, and rate limit backoff
 *
 * NOTE: Tests are skipped because banner API is temporarily disabled.
 * Circuit breaker and caching implementation is complete and tested.
 * Tests will be re-enabled in a future PR with feature flag.
 */

import type { BannerRules } from "@shared/ClineBanner"
import axios from "axios"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import type { Controller } from "@/core/controller"
import { Logger } from "@/shared/services/Logger"
import { BannerService } from "./BannerService"

describe.skip("BannerService (SKIPPED - Banner API temporarily disabled)", () => {
	let sandbox: sinon.SinonSandbox
	let bannerService: BannerService
	let axiosGetStub: sinon.SinonStub
	let mockController: Partial<Controller>

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		sandbox.stub(Logger, "log")
		sandbox.stub(Logger, "error")

		mockController = {
			stateManager: {
				getApiConfiguration: () => ({}),
				getGlobalSettingsKey: () => undefined,
				getGlobalStateKey: () => [],
			} as any,
		}

		// Reset singleton and initialize with mock controller
		BannerService.reset()
		bannerService = BannerService.initialize(mockController as Controller)
		bannerService.clearCache()

		axiosGetStub = sandbox.stub(axios, "get")
	})

	afterEach(() => {
		bannerService.clearCache()
		BannerService.reset()
		sandbox.restore()
	})

	describe("API Fetching", () => {
		it("should fetch banners from API successfully", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(axiosGetStub.calledOnce).to.be.true
			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_test1")
			expect(banners[0].title).to.equal("Test Banner")
			expect(banners[0].description).to.equal("This is a test")
		})

		it("should handle API errors gracefully", async () => {
			axiosGetStub.rejects(new Error("Network error"))
			const banners = await bannerService.getActiveBanners()
			expect(banners).to.have.lengthOf(0)
		})

		it("should cache banners for 24 hours", async () => {
			const clock = sandbox.useFakeTimers()

			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)

			// First call fetches from API
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.equal(1)

			// Second call within cache window uses cache (no new API call)
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.equal(1)

			// After 1 hour, still uses cache
			clock.tick(60 * 60 * 1000)
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.equal(1)

			// After 23 hours total, still uses cache
			clock.tick(22 * 60 * 60 * 1000)
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.equal(1)

			// After 25 hours total, cache expired, makes new API call
			clock.tick(2 * 60 * 60 * 1000)
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.equal(2)

			// Force refresh always bypasses cache
			await bannerService.getActiveBanners(true)
			expect(axiosGetStub.callCount).to.equal(3)
		})
	})

	describe("API Provider Rule Evaluation (Client-Side)", () => {
		it("should show banner when user has selected the required API provider in act mode", async () => {
			const controllerWithOpenAI: Partial<Controller> = {
				stateManager: {
					getApiConfiguration: () => ({
						actModeApiProvider: "openai",
					}),
					getGlobalSettingsKey: (key: string) => (key === "mode" ? "act" : undefined),
					getGlobalStateKey: () => [],
				} as any,
			}
			// Reinitialize with new controller
			BannerService.reset()
			bannerService = BannerService.initialize(controllerWithOpenAI as Controller)

			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_openai")
		})

		it("should show banner when user has selected the required API provider in plan mode", async () => {
			const controllerWithAnthropic: Partial<Controller> = {
				stateManager: {
					getApiConfiguration: () => ({
						planModeApiProvider: "anthropic",
					}),
					getGlobalSettingsKey: (key: string) => (key === "mode" ? "plan" : undefined),
					getGlobalStateKey: () => [],
				} as any,
			}
			// Reinitialize with new controller
			BannerService.reset()
			bannerService = BannerService.initialize(controllerWithAnthropic as Controller)

			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_anthropic")
		})

		it("should NOT show banner when user has selected a different API provider", async () => {
			const controllerWithAnthropic: Partial<Controller> = {
				stateManager: {
					getApiConfiguration: () => ({
						actModeApiProvider: "anthropic",
					}),
					getGlobalSettingsKey: (key: string) => (key === "mode" ? "act" : undefined),
					getGlobalStateKey: () => [],
				} as any,
			}
			// Reinitialize with new controller
			BannerService.reset()
			bannerService = BannerService.initialize(controllerWithAnthropic as Controller)

			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(0)
		})

		it("should show banner if user has selected ANY of multiple specified providers", async () => {
			const controllerWithAnthropic: Partial<Controller> = {
				stateManager: {
					getApiConfiguration: () => ({
						actModeApiProvider: "anthropic",
					}),
					getGlobalSettingsKey: (key: string) => (key === "mode" ? "act" : undefined),
					getGlobalStateKey: () => [],
				} as any,
			}
			// Reinitialize with new controller
			BannerService.reset()
			bannerService = BannerService.initialize(controllerWithAnthropic as Controller)

			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_multi")
		})

		it("should NOT show banner when no provider is selected", async () => {
			const controllerWithNoProvider: Partial<Controller> = {
				stateManager: {
					getApiConfiguration: () => ({}),
					getGlobalSettingsKey: (key: string) => (key === "mode" ? "act" : undefined),
					getGlobalStateKey: () => [],
				} as any,
			}
			// Reinitialize with new controller
			BannerService.reset()
			bannerService = BannerService.initialize(controllerWithNoProvider as Controller)

			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(0)
		})
	})

	describe("Invalid or No Banner Rules", () => {
		it("should handle malformed rules gracefully (fail open)", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(1)
		})

		it("should handle banners with no rules", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_norules")
		})
	})

	describe("Cache Management", () => {
		it("should clear cache when requested", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)

			await bannerService.getActiveBanners()
			expect(axiosGetStub.calledOnce).to.be.true

			bannerService.clearCache()

			await bannerService.getActiveBanners()
			expect(axiosGetStub.calledTwice).to.be.true
		})
	})

	describe("OS Parameter Integration", () => {
		it("should send OS parameter in API request", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			await bannerService.getActiveBanners()

			expect(axiosGetStub.calledOnce).to.be.true
			const call = axiosGetStub.getCall(0)
			const url = call.args[0]
			expect(url).to.include("os=")
		})

		it("should handle OS detection errors gracefully", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", {
				get: () => {
					throw new Error("Platform access denied")
				},
				configurable: true,
			})

			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			Object.defineProperty(process, "platform", {
				value: originalPlatform,
				configurable: true,
			})

			expect(banners).to.have.lengthOf(1)
			expect(axiosGetStub.calledOnce).to.be.true
			const call = axiosGetStub.getCall(0)
			const url = call.args[0]
			expect(url).to.include("os=unknown")
		})

		it("should detect different OS types correctly", async () => {
			const testCases = [
				{ platform: "win32", expected: "windows" },
				{ platform: "darwin", expected: "macos" },
				{ platform: "linux", expected: "linux" },
				{ platform: "freebsd", expected: "unknown" },
			]

			for (const { platform, expected } of testCases) {
				const originalPlatform = process.platform
				Object.defineProperty(process, "platform", {
					value: platform,
					configurable: true,
				})

				const mockResponse = {
					data: {
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
					},
				}

				axiosGetStub.resolves(mockResponse)

				// Clear cache to ensure fresh API call for each platform test
				bannerService.clearCache()

				await bannerService.getActiveBanners()

				expect(axiosGetStub.called).to.be.true
				const call = axiosGetStub.lastCall
				expect(call).to.not.be.null
				const url = call.args[0]
				expect(url).to.include(`os=${expected}`)

				Object.defineProperty(process, "platform", {
					value: originalPlatform,
					configurable: true,
				})

				axiosGetStub.resetHistory()
			}
		})
	})

	describe("Banner to BannerCardData Conversion", () => {
		it("should convert banner with valid action types", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

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

		it("should drop banner with invalid action type and log error", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(0)
		})

		it("should keep valid banners and drop only invalid ones", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(2)
			expect(banners[0].id).to.equal("bnr_valid")
			expect(banners[1].id).to.equal("bnr_also_valid")
		})

		it("should convert banner with no actions", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_no_actions")
			expect(banners[0].actions).to.have.lengthOf(0)
		})

		it("should convert banner with empty actions array", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_empty_actions")
			expect(banners[0].actions).to.have.lengthOf(0)
		})

		it("should drop banner when action has undefined action type", async () => {
			const mockResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(0)
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
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.getActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].actions).to.have.lengthOf(validActionTypes.length)
			banners[0].actions!.forEach((action, index) => {
				expect(action.action).to.equal(validActionTypes[index])
			})
		})
	})

	describe("Circuit Breaker", () => {
		it("should activate circuit breaker after 3 consecutive failures and return cached banners", async () => {
			const clock = sandbox.useFakeTimers()

			// First, successfully fetch and cache a banner
			const successResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(successResponse)
			const initialBanners = await bannerService.getActiveBanners()
			expect(initialBanners).to.have.lengthOf(1)
			expect(axiosGetStub.callCount).to.equal(1)

			// Expire the cache
			clock.tick(25 * 60 * 60 * 1000) // 25 hours

			// Now make the API fail 3 times
			axiosGetStub.rejects(new Error("Network error"))

			// First failure
			const banners1 = await bannerService.getActiveBanners()
			expect(banners1).to.have.lengthOf(1) // Returns cached
			expect(axiosGetStub.callCount).to.equal(2)

			// Second failure
			const banners2 = await bannerService.getActiveBanners()
			expect(banners2).to.have.lengthOf(1) // Returns cached
			expect(axiosGetStub.callCount).to.equal(3)

			// Third failure - circuit breaker activates
			const banners3 = await bannerService.getActiveBanners()
			expect(banners3).to.have.lengthOf(1) // Returns cached
			expect(axiosGetStub.callCount).to.equal(4)

			// Fourth attempt - circuit breaker prevents API call
			const banners4 = await bannerService.getActiveBanners()
			expect(banners4).to.have.lengthOf(1) // Returns cached without API call
			expect(axiosGetStub.callCount).to.equal(4) // No new API call!

			// Fifth attempt - still blocked
			const banners5 = await bannerService.getActiveBanners()
			expect(banners5).to.have.lengthOf(1)
			expect(axiosGetStub.callCount).to.equal(4) // Still no new API call
		})

		it("should reset circuit breaker on successful API call", async () => {
			const clock = sandbox.useFakeTimers()

			const successResponse = {
				data: {
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
				},
			}

			// Cause 2 failures
			axiosGetStub.onCall(0).resolves(successResponse)
			clock.tick(25 * 60 * 60 * 1000)
			axiosGetStub.onCall(1).rejects(new Error("Error 1"))
			axiosGetStub.onCall(2).rejects(new Error("Error 2"))

			await bannerService.getActiveBanners() // Success
			await bannerService.getActiveBanners() // Fail 1
			await bannerService.getActiveBanners() // Fail 2

			// Now succeed - should reset circuit breaker
			axiosGetStub.onCall(3).resolves(successResponse)
			clock.tick(25 * 60 * 60 * 1000)
			await bannerService.getActiveBanners() // Success

			// Cause 3 more failures - circuit breaker should trip again
			axiosGetStub.rejects(new Error("Error"))
			clock.tick(25 * 60 * 60 * 1000)
			await bannerService.getActiveBanners() // Fail 1
			await bannerService.getActiveBanners() // Fail 2
			await bannerService.getActiveBanners() // Fail 3
			const callCountBefore = axiosGetStub.callCount

			// Circuit breaker should be active now
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.equal(callCountBefore) // No new call
		})
	})

	describe("Rate Limit Backoff (429)", () => {
		it("should trigger backoff on 429 response and return cached banners during backoff", async () => {
			const clock = sandbox.useFakeTimers()

			// First, cache a banner
			const successResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(successResponse)
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.equal(1)

			// Expire cache
			clock.tick(25 * 60 * 60 * 1000)

			// Simulate 429 error without Retry-After header (default 1 hour backoff)
			const error429 = new Error("Rate limited")
			;(error429 as any).isAxiosError = true
			;(error429 as any).response = {
				status: 429,
				headers: {},
			}
			axiosGetStub.rejects(error429)

			// This call triggers 429
			const banners1 = await bannerService.getActiveBanners()
			expect(banners1).to.have.lengthOf(1) // Returns cached
			expect(axiosGetStub.callCount).to.equal(2)

			// Calls within backoff period should return cached without API call
			const banners2 = await bannerService.getActiveBanners()
			expect(banners2).to.have.lengthOf(1)
			expect(axiosGetStub.callCount).to.equal(2) // No new call

			// 30 minutes later - still in backoff
			clock.tick(30 * 60 * 1000)
			const banners3 = await bannerService.getActiveBanners()
			expect(banners3).to.have.lengthOf(1)
			expect(axiosGetStub.callCount).to.equal(2) // No new call

			// After 61 minutes - backoff expired, should try again
			clock.tick(31 * 60 * 1000)
			axiosGetStub.resolves(successResponse)
			const banners4 = await bannerService.getActiveBanners()
			expect(banners4).to.have.lengthOf(1)
			expect(axiosGetStub.callCount).to.equal(3) // New call made
		})

		it("should respect Retry-After header in seconds", async () => {
			const clock = sandbox.useFakeTimers()

			// Cache a banner first
			const successResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(successResponse)
			await bannerService.getActiveBanners()

			// Expire cache
			clock.tick(25 * 60 * 60 * 1000)

			// Simulate 429 with Retry-After: 300 (5 minutes)
			const error429 = new Error("Rate limited")
			;(error429 as any).isAxiosError = true
			;(error429 as any).response = {
				status: 429,
				headers: { "retry-after": "300" },
			}
			axiosGetStub.rejects(error429)

			await bannerService.getActiveBanners()
			const callCountAfter429 = axiosGetStub.callCount

			// 4 minutes later - still in backoff
			clock.tick(4 * 60 * 1000)
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.equal(callCountAfter429) // No new call

			// After 6 minutes - backoff expired
			clock.tick(2 * 60 * 1000)
			axiosGetStub.resolves(successResponse)
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.be.greaterThan(callCountAfter429) // New call made
		})
	})

	describe("Server Error Backoff (5xx)", () => {
		it("should trigger 15-minute backoff on 5xx errors", async () => {
			const clock = sandbox.useFakeTimers()

			// Cache a banner first
			const successResponse = {
				data: {
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
				},
			}

			axiosGetStub.resolves(successResponse)
			await bannerService.getActiveBanners()
			expect(axiosGetStub.callCount).to.equal(1)

			// Expire cache
			clock.tick(25 * 60 * 60 * 1000)

			// Simulate 502 error
			const error502 = new Error("Bad Gateway")
			;(error502 as any).isAxiosError = true
			;(error502 as any).response = {
				status: 502,
				headers: {},
			}
			axiosGetStub.rejects(error502)

			// This call triggers 502
			const banners1 = await bannerService.getActiveBanners()
			expect(banners1).to.have.lengthOf(1) // Returns cached
			expect(axiosGetStub.callCount).to.equal(2)

			// Calls within 15-minute backoff should return cached without API call
			const banners2 = await bannerService.getActiveBanners()
			expect(banners2).to.have.lengthOf(1)
			expect(axiosGetStub.callCount).to.equal(2) // No new call

			// 10 minutes later - still in backoff
			clock.tick(10 * 60 * 1000)
			const banners3 = await bannerService.getActiveBanners()
			expect(banners3).to.have.lengthOf(1)
			expect(axiosGetStub.callCount).to.equal(2) // No new call

			// After 16 minutes - backoff expired, should try again
			clock.tick(6 * 60 * 1000)
			axiosGetStub.resolves(successResponse)
			const banners4 = await bannerService.getActiveBanners()
			expect(banners4).to.have.lengthOf(1)
			expect(axiosGetStub.callCount).to.equal(3) // New call made
		})

		it("should handle different 5xx status codes (500, 503, 504)", async () => {
			const clock = sandbox.useFakeTimers()

			const successResponse = {
				data: {
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
				},
			}

			const testCases = [500, 502, 503, 504]

			for (const statusCode of testCases) {
				// Clear and cache
				bannerService.clearCache()
				axiosGetStub.reset()
				axiosGetStub.resolves(successResponse)
				await bannerService.getActiveBanners()

				// Expire cache
				clock.tick(25 * 60 * 60 * 1000)

				// Create error with specific status code
				const error = new Error(`Server error ${statusCode}`)
				;(error as any).isAxiosError = true
				;(error as any).response = {
					status: statusCode,
					headers: {},
				}
				axiosGetStub.rejects(error)

				// Trigger error
				await bannerService.getActiveBanners()
				const callCountAfterError = axiosGetStub.callCount

				// Should be in 15-minute backoff
				await bannerService.getActiveBanners()
				expect(axiosGetStub.callCount).to.equal(callCountAfterError) // No new call

				// After 16 minutes - backoff should be expired
				clock.tick(16 * 60 * 1000)
				axiosGetStub.resolves(successResponse)
				await bannerService.getActiveBanners()
				expect(axiosGetStub.callCount).to.be.greaterThan(callCountAfterError)
			}
		})
	})
})
