import * as assert from "assert"
import * as sinon from "sinon"
import axios from "axios"
import { PromptsService } from "@/services/prompts/PromptsService"

describe("PromptsService", () => {
	let service: PromptsService
	let axiosGetStub: sinon.SinonStub

	beforeEach(() => {
		service = new PromptsService()
		axiosGetStub = sinon.stub(axios, "get")
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("fetchPromptsCatalog", () => {
		describe("Frontmatter Parsing", () => {
			it("should parse valid frontmatter with all fields", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: `---
description: Test description
author: testuser
category: Testing
tags: [tag1, tag2, tag3]
---
# Test Content`,
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] }) // workflows directory

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 1)
				assert.strictEqual(catalog.items[0].description, "Test description")
				assert.strictEqual(catalog.items[0].author, "testuser")
				assert.strictEqual(catalog.items[0].category, "Testing")
				assert.deepStrictEqual(catalog.items[0].tags, ["tag1", "tag2", "tag3"])
			})

			it("should handle frontmatter with single quotes", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: `---
description: 'Single quoted description'
author: 'testuser'
category: 'Testing'
tags: ['tag1', 'tag2']
---
Content`,
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] })

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].description, "Single quoted description")
				assert.strictEqual(catalog.items[0].author, "testuser")
				assert.deepStrictEqual(catalog.items[0].tags, ["tag1", "tag2"])
			})

			it("should handle missing optional fields", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: `---
description: Only description
---
Content`,
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] })

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].description, "Only description")
				assert.strictEqual(catalog.items[0].author, "Unknown")
				assert.strictEqual(catalog.items[0].category, "General")
				assert.deepStrictEqual(catalog.items[0].tags, [])
			})

			it("should extract GitHub username from author URL", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: `---
description: Test
author: https://github.com/octocat
---
Content`,
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] })

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].author, "octocat")
			})

			it("should handle content with no frontmatter", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: "# Just content, no frontmatter",
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] })

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].description, "No description available")
				assert.strictEqual(catalog.items[0].author, "Unknown")
				assert.strictEqual(catalog.items[0].category, "General")
			})

			it("should handle incomplete frontmatter (missing closing ---)", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: `---
description: Test
author: testuser
Content without closing delimiter`,
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] })

				const catalog = await service.fetchPromptsCatalog()

				// Should fall back to defaults when frontmatter is malformed
				assert.strictEqual(catalog.items[0].description, "No description available")
			})

			it("should handle empty tag array", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: `---
description: Test
tags: []
---
Content`,
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] })

				const catalog = await service.fetchPromptsCatalog()

				assert.deepStrictEqual(catalog.items[0].tags, [])
			})

			it("should handle malformed tag array (missing brackets)", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: `---
description: Test
tags: tag1, tag2
---
Content`,
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] })

				const catalog = await service.fetchPromptsCatalog()

				// Should default to empty array when tags format is invalid
				assert.deepStrictEqual(catalog.items[0].tags, [])
			})
		})

		describe("GitHub API Error Handling", () => {
			it("should return empty catalog on network timeout", async () => {
				const timeoutError = new Error("Timeout")
				timeoutError.name = "ETIMEDOUT"
				axiosGetStub.rejects(timeoutError)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
				assert.ok(catalog.lastUpdated)
			})

			it("should return empty catalog on 404 response", async () => {
				const error: any = new Error("Not Found")
				error.response = { status: 404 }
				axiosGetStub.rejects(error)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should return empty catalog on 403 rate limit", async () => {
				const error: any = new Error("Rate limit exceeded")
				error.response = { status: 403 }
				axiosGetStub.rejects(error)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should return empty catalog on 500 server error", async () => {
				const error: any = new Error("Server error")
				error.response = { status: 500 }
				axiosGetStub.rejects(error)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should handle malformed JSON response", async () => {
				axiosGetStub.resolves({ data: "not json" })

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should handle empty directory response", async () => {
				axiosGetStub.resolves({ data: [] })

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should handle partial success (some files fail)", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "good-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/good.md",
							html_url: "https://github.com/good.md",
						},
						{
							name: "bad-prompt.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/bad.md",
							html_url: "https://github.com/bad.md",
						},
					],
				}

				const mockGoodContent = {
					data: `---
description: Good prompt
---
Content`,
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockGoodContent)
					.onThirdCall()
					.rejects(new Error("Failed to fetch"))
					.onCall(3)
					.resolves({ data: [] }) // workflows directory

				const catalog = await service.fetchPromptsCatalog()

				// Should still include the successful file
				assert.strictEqual(catalog.items.length, 1)
				assert.strictEqual(catalog.items[0].name, "Good Prompt")
			})
		})

		describe("Caching Behavior", () => {
			it("should cache results after first fetch", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: `---
description: Test
---
Content`,
				}

				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] })

				// First fetch
				await service.fetchPromptsCatalog()

				// Second fetch should use cache (no new API calls)
				axiosGetStub.resetHistory()
				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(axiosGetStub.callCount, 0, "Should not make API calls when cache is fresh")
				assert.strictEqual(catalog.items.length, 1)
			})

			it("should refetch after cache expiration (1 hour)", async () => {
				const mockDirectoryResponse = {
					data: [
						{
							name: "test.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/test.md",
							html_url: "https://github.com/test.md",
						},
					],
				}

				const mockContentResponse = {
					data: `---
description: Test
---
Content`,
				}

				axiosGetStub.resolves(mockDirectoryResponse).onSecondCall().resolves(mockContentResponse)

				// First fetch
				await service.fetchPromptsCatalog()

				// Manually expire cache by setting lastFetchTime
				;(service as any).lastFetchTime = Date.now() - 61 * 60 * 1000 // 61 minutes ago

				axiosGetStub.resetHistory()
				axiosGetStub
					.onFirstCall()
					.resolves(mockDirectoryResponse)
					.onSecondCall()
					.resolves(mockContentResponse)
					.onThirdCall()
					.resolves({ data: [] })

				// Should make new API calls
				await service.fetchPromptsCatalog()

				assert.ok(axiosGetStub.callCount > 0, "Should make API calls when cache is expired")
			})
		})
	})
})
