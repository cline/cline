/**
 * Tests for BannerService
 * Tests API fetching, caching, and client-side provider filtering
 */

import type { BannerRules } from "@shared/ClineBanner"
import axios from "axios"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import type { Controller } from "@/core/controller"
import { Logger } from "../logging/Logger"
import { BannerService } from "./BannerService"

describe("BannerService", () => {
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
			const banners = await bannerService.fetchActiveBanners()

			expect(axiosGetStub.calledOnce).to.be.true
			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_test1")
		})

		it("should handle API errors gracefully", async () => {
			axiosGetStub.rejects(new Error("Network error"))
			const banners = await bannerService.fetchActiveBanners()
			expect(banners).to.have.lengthOf(0)
		})

		it("should cache banners for 5 minutes", async () => {
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
			await bannerService.fetchActiveBanners()
			expect(axiosGetStub.callCount).to.equal(1)

			// Second call within cache window uses cache (no new API call)
			await bannerService.fetchActiveBanners()
			expect(axiosGetStub.callCount).to.equal(1)

			// After 4 minutes, still uses cache
			clock.tick(4 * 60 * 1000)
			await bannerService.fetchActiveBanners()
			expect(axiosGetStub.callCount).to.equal(1)

			// After 6 minutes total, cache expired, makes new API call
			clock.tick(2 * 60 * 1000)
			await bannerService.fetchActiveBanners()
			expect(axiosGetStub.callCount).to.equal(2)

			// Force refresh always bypasses cache
			await bannerService.fetchActiveBanners(true)
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
			const banners = await bannerService.fetchActiveBanners()

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
			const banners = await bannerService.fetchActiveBanners()

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
			const banners = await bannerService.fetchActiveBanners()

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
			const banners = await bannerService.fetchActiveBanners()

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
			const banners = await bannerService.fetchActiveBanners()

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
			const banners = await bannerService.fetchActiveBanners()

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
			const banners = await bannerService.fetchActiveBanners()

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

			await bannerService.fetchActiveBanners()
			expect(axiosGetStub.calledOnce).to.be.true

			bannerService.clearCache()

			await bannerService.fetchActiveBanners()
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
			await bannerService.fetchActiveBanners()

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
			const banners = await bannerService.fetchActiveBanners()

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

				await bannerService.fetchActiveBanners()

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
})
