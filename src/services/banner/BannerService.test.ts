/**
 * Tests for BannerService
 * Tests API fetching, caching, and rule evaluation logic
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
						banners: [
							{
								id: "bnr_test1",
								titleMd: "Test Banner",
								bodyMd: "This is a test",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: "{}",
								activeFrom: new Date(Date.now() - 86400000).toISOString(),
								activeTo: new Date(Date.now() + 86400000).toISOString(),
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
						banners: [
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

	describe("Date Range Filtering", () => {
		it("should filter out expired banners", async () => {
			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_expired",
								titleMd: "Expired",
								bodyMd: "Test",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: "{}",
								activeFrom: new Date(Date.now() - 172800000).toISOString(),
								activeTo: new Date(Date.now() - 86400000).toISOString(), // activeTo is in the Past
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()
			expect(banners).to.have.lengthOf(0)
		})

		it("should filter out future banners", async () => {
			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_future",
								titleMd: "Future",
								bodyMd: "Test",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: "{}",
								activeFrom: new Date(Date.now() + 86400000).toISOString(), // activeFrom is in the Future
								activeTo: new Date(Date.now() + 172800000).toISOString(),
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()
			expect(banners).to.have.lengthOf(0)
		})

		it("should include currently active banners", async () => {
			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_active",
								titleMd: "Active",
								bodyMd: "Test",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: "{}",
								activeFrom: new Date(Date.now() - 86400000).toISOString(),
								activeTo: new Date(Date.now() + 86400000).toISOString(),
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()
			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_active")
		})
	})

	describe("API Provider Rule Evaluation", () => {
		it("should show banner when user has the required API provider configured", async () => {
			const controllerWithOpenAI: Partial<Controller> = {
				stateManager: {
					getApiConfiguration: () => ({
						openAiApiKey: "sk-test-key",
					}),
					getGlobalSettingsKey: () => undefined,
					getGlobalStateKey: () => [],
				} as any,
			}
			// Reinitialize with new controller
			BannerService.reset()
			bannerService = BannerService.initialize(controllerWithOpenAI as Controller)

			const mockResponse = {
				data: {
					data: {
						banners: [
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

		it("should NOT show banner when user doesn't have the required API provider", async () => {
			const controllerWithoutOpenAI: Partial<Controller> = {
				stateManager: {
					getApiConfiguration: () => ({
						apiKey: "sk-ant-test", // Has Anthropic key but not OpenAI
					}),
					getGlobalSettingsKey: () => undefined,
					getGlobalStateKey: () => [],
				} as any,
			}
			// Reinitialize with new controller
			BannerService.reset()
			bannerService = BannerService.initialize(controllerWithoutOpenAI as Controller)

			const mockResponse = {
				data: {
					data: {
						banners: [
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

		it("should show banner if user has ANY of multiple specified providers", async () => {
			const controllerWithAnthropic: Partial<Controller> = {
				stateManager: {
					getApiConfiguration: () => ({
						apiKey: "sk-ant-test", // Has Anthropic key
					}),
					getGlobalSettingsKey: () => undefined,
					getGlobalStateKey: () => [],
				} as any,
			}
			// Reinitialize with new controller
			BannerService.reset()
			bannerService = BannerService.initialize(controllerWithAnthropic as Controller)

			const mockResponse = {
				data: {
					data: {
						banners: [
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
	})

	describe("Audience Targeting", () => {
		it("should show banner targeting all users", async () => {
			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_all",
								titleMd: "All Users",
								bodyMd: "For everyone",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: JSON.stringify({ audience: "all" } as BannerRules),
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_all")
		})

		it("should show team admin banner to admin users", async () => {
			const mockAuthService = {
				getUserOrganizations: () => [{ id: "org1", name: "Test Org", roles: ["admin"] }],
				getInfo: () => ({ user: { email: "test@example.com" } }),
			} as any

			bannerService.setAuthService(mockAuthService)

			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_admin",
								titleMd: "Team Admins",
								bodyMd: "For team admins only",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: JSON.stringify({ audience: "team admin only" } as BannerRules),
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_admin")
		})

		it("should show team admin banner to owner users", async () => {
			const mockAuthService = {
				getUserOrganizations: () => [{ id: "org1", name: "Test Org", roles: ["owner"] }],
				getInfo: () => ({ user: { email: "test@example.com" } }),
			} as any

			bannerService.setAuthService(mockAuthService)

			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_admin",
								titleMd: "Team Admins",
								bodyMd: "For team admins only",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: JSON.stringify({ audience: "team admin only" } as BannerRules),
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_admin")
		})

		it("should NOT show team admin banner to non-admin users", async () => {
			const mockAuthService = {
				getUserOrganizations: () => [{ id: "org1", name: "Test Org", roles: ["member"] }],
				getInfo: () => ({ user: { email: "test@example.com" } }),
			} as any

			bannerService.setAuthService(mockAuthService)

			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_admin",
								titleMd: "Team Admins",
								bodyMd: "For team admins only",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: JSON.stringify({ audience: "team admin only" } as BannerRules),
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()

			expect(banners).to.have.lengthOf(0)
		})

		it("should show team members banner to users in organizations", async () => {
			const mockAuthService = {
				getUserOrganizations: () => [{ id: "org1", name: "Test Org", roles: ["member"] }],
				getInfo: () => ({ user: { email: "test@example.com" } }),
			} as any

			bannerService.setAuthService(mockAuthService)

			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_team",
								titleMd: "Team Members",
								bodyMd: "For team members",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: JSON.stringify({ audience: "team members" } as BannerRules),
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_team")
		})

		it("should NOT show team members banner to users without organizations", async () => {
			const mockAuthService = {
				getUserOrganizations: () => [],
				getInfo: () => ({ user: { email: "test@example.com" } }),
			} as any

			bannerService.setAuthService(mockAuthService)

			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_team",
								titleMd: "Team Members",
								bodyMd: "For team members",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: JSON.stringify({ audience: "team members" } as BannerRules),
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()

			expect(banners).to.have.lengthOf(0)
		})

		it("should show personal banner to users without organizations", async () => {
			const mockAuthService = {
				getUserOrganizations: () => [],
				getInfo: () => ({ user: { email: "test@example.com" } }),
			} as any

			bannerService.setAuthService(mockAuthService)

			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_personal",
								titleMd: "Personal Users",
								bodyMd: "For personal users",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: JSON.stringify({ audience: "personal only" } as BannerRules),
							},
						],
					},
				},
			}

			axiosGetStub.resolves(mockResponse)
			const banners = await bannerService.fetchActiveBanners()

			expect(banners).to.have.lengthOf(1)
			expect(banners[0].id).to.equal("bnr_personal")
		})

		it("should NOT show personal banner to users with organizations", async () => {
			const mockAuthService = {
				getUserOrganizations: () => [{ id: "org1", name: "Test Org", roles: ["member"] }],
				getInfo: () => ({ user: { email: "test@example.com" } }),
			} as any

			bannerService.setAuthService(mockAuthService)

			const mockResponse = {
				data: {
					data: {
						banners: [
							{
								id: "bnr_personal",
								titleMd: "Personal Users",
								bodyMd: "For personal users",
								severity: "info" as const,
								placement: "top" as const,
								rulesJson: JSON.stringify({ audience: "personal only" } as BannerRules),
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
						banners: [
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
						banners: [
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
						banners: [
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
})
