import * as assert from "assert"
import * as sinon from "sinon"
import { PromptsService } from "@/services/prompts/PromptsService"

/**
 * Helper: builds a mock Git Trees API response with entries in .clinerules/ and/or workflows/.
 * Each entry is a blob path like ".clinerules/test-prompt.md".
 */
function mockTreeResponse(paths: string[]) {
	return {
		data: {
			sha: "abc123",
			tree: paths.map((path) => ({ path, type: "blob", mode: "100644", sha: "def456" })),
			truncated: false,
		},
	}
}

describe("PromptsService", () => {
	let service: PromptsService
	let httpGetStub: sinon.SinonStub

	beforeEach(() => {
		service = new PromptsService()
		// Stub the instance's httpGet method directly to avoid module-level
		// stubbing issues with axios/getAxiosSettings in CI environments
		httpGetStub = sinon.stub(service as any, "httpGet")
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("fetchPromptsCatalog", () => {
		describe("Frontmatter Parsing", () => {
			it("should parse valid frontmatter with all fields", async () => {
				const mockContentResponse = {
					data: `---
description: Test description
author: testuser
category: Testing
tags: [tag1, tag2, tag3]
---
# Test Content`,
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 1)
				assert.strictEqual(catalog.items[0].description, "Test description")
				assert.strictEqual(catalog.items[0].author, "testuser")
				assert.strictEqual(catalog.items[0].category, "Testing")
				assert.deepStrictEqual(catalog.items[0].tags, ["tag1", "tag2", "tag3"])
			})

			it("should handle frontmatter with single quotes", async () => {
				const mockContentResponse = {
					data: `---
description: 'Single quoted description'
author: 'testuser'
category: 'Testing'
tags: ['tag1', 'tag2']
---
Content`,
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].description, "Single quoted description")
				assert.strictEqual(catalog.items[0].author, "testuser")
				assert.deepStrictEqual(catalog.items[0].tags, ["tag1", "tag2"])
			})

			it("should handle missing optional fields", async () => {
				const mockContentResponse = {
					data: `---
description: Only description
---
Content`,
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].description, "Only description")
				assert.strictEqual(catalog.items[0].author, "Unknown")
				assert.strictEqual(catalog.items[0].category, "General")
				assert.deepStrictEqual(catalog.items[0].tags, [])
			})

			it("should extract GitHub username from author URL", async () => {
				const mockContentResponse = {
					data: `---
description: Test
author: https://github.com/octocat
---
Content`,
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].author, "octocat")
			})

			it("should handle content with no frontmatter", async () => {
				const mockContentResponse = {
					data: "# Just content, no frontmatter",
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].description, "No description available")
				assert.strictEqual(catalog.items[0].author, "Unknown")
				assert.strictEqual(catalog.items[0].category, "General")
			})

			it("should handle incomplete frontmatter (missing closing ---)", async () => {
				const mockContentResponse = {
					data: `---
description: Test
author: testuser
Content without closing delimiter`,
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				// Should fall back to defaults when frontmatter is malformed
				assert.strictEqual(catalog.items[0].description, "No description available")
			})

			it("should handle empty tag array", async () => {
				const mockContentResponse = {
					data: `---
description: Test
tags: []
---
Content`,
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.deepStrictEqual(catalog.items[0].tags, [])
			})

			it("should parse version, created_at, and updated_at from frontmatter", async () => {
				const mockContentResponse = {
					data: `---
description: Test description
author: testuser
version: 2.5
created_at: 2025-01-15
updated_at: 2025-06-01
category: Testing
tags: [tag1]
---
Content`,
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].version, "2.5")
				assert.strictEqual(catalog.items[0].createdAt, "2025-01-15")
				assert.strictEqual(catalog.items[0].updatedAt, "2025-06-01")
			})

			it("should trim whitespace from frontmatter values", async () => {
				const mockContentResponse = {
					data: `---
description: Description with spaces   
author: Author Name   
category: Category   
---
Content`,
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].description, "Description with spaces")
				assert.strictEqual(catalog.items[0].author, "Author Name")
				assert.strictEqual(catalog.items[0].category, "Category")
			})

			it("should handle malformed tag array (missing brackets)", async () => {
				const mockContentResponse = {
					data: `---
description: Test
tags: tag1, tag2
---
Content`,
				}

				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test-prompt.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return mockContentResponse
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				// Should default to empty array when tags format is invalid
				assert.deepStrictEqual(catalog.items[0].tags, [])
			})
		})

		describe("Directory Type Mapping", () => {
			it("should map files in different directories to correct types", async () => {
				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([
							".clinerules/rule-file.md",
							"workflows/workflow-file.md",
							"hooks/hook-file.md",
							"skills/skill-file.md",
						])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return {
							data: `---
description: Test
---
Content`,
						}
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 4)
				assert.strictEqual(catalog.items.find((i) => i.promptId === "rule-file")?.type, "rule")
				assert.strictEqual(catalog.items.find((i) => i.promptId === "workflow-file")?.type, "workflow")
				assert.strictEqual(catalog.items.find((i) => i.promptId === "hook-file")?.type, "hook")
				assert.strictEqual(catalog.items.find((i) => i.promptId === "skill-file")?.type, "skill")
			})

			it("should ignore files not in known directories", async () => {
				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse(["README.md", ".clinerules/valid.md", "unknown-dir/file.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return {
							data: `---
description: Test
---
Content`,
						}
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 1)
				assert.strictEqual(catalog.items[0].promptId, "valid")
			})
		})

		describe("GitHub API Error Handling", () => {
			it("should return empty catalog on network timeout", async () => {
				const timeoutError = new Error("Timeout")
				timeoutError.name = "ETIMEDOUT"
				httpGetStub.rejects(timeoutError)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
				assert.ok(catalog.lastUpdated)
			})

			it("should return empty catalog on 404 response", async () => {
				const error: any = new Error("Not Found")
				error.response = { status: 404 }
				httpGetStub.rejects(error)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should return empty catalog on 403 rate limit", async () => {
				const error: any = new Error("Rate limit exceeded")
				error.response = { status: 403 }
				httpGetStub.rejects(error)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should return empty catalog on 500 server error", async () => {
				const error: any = new Error("Server error")
				error.response = { status: 500 }
				httpGetStub.rejects(error)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should handle malformed tree response", async () => {
				httpGetStub.resolves({ data: "not json" })

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should handle empty tree response", async () => {
				httpGetStub.resolves({ data: { tree: [] } })

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})

			it("should handle partial success (some files fail)", async () => {
				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/good-prompt.md", ".clinerules/bad-prompt.md"])
					}
					if (url.includes("good-prompt.md")) {
						return {
							data: `---
description: Good prompt
---
Content`,
						}
					}
					if (url.includes("bad-prompt.md")) {
						throw new Error("Failed to fetch")
					}
					return { data: {} }
				})

				const catalog = await service.fetchPromptsCatalog()

				// Should still include the successful file
				assert.strictEqual(catalog.items.length, 1)
				assert.strictEqual(catalog.items[0].name, "Good Prompt")
			})
		})

		describe("Caching Behavior", () => {
			it("should cache results after first fetch", async () => {
				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return {
							data: `---
description: Test
---
Content`,
						}
					}
					return { data: {} }
				})

				// First fetch
				await service.fetchPromptsCatalog()

				// Second fetch should use cache (no new API calls)
				httpGetStub.resetHistory()
				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(httpGetStub.callCount, 0, "Should not make API calls when cache is fresh")
				assert.strictEqual(catalog.items.length, 1)
			})

			it("should refetch after cache expiration (1 hour)", async () => {
				httpGetStub.callsFake(async (url: string) => {
					if (url.includes("/git/trees/main")) {
						return mockTreeResponse([".clinerules/test.md"])
					}
					if (url.startsWith("https://raw.githubusercontent.com/")) {
						return {
							data: `---
description: Test
---
Content`,
						}
					}
					return { data: {} }
				})

				// First fetch
				await service.fetchPromptsCatalog()

				// Manually expire cache by setting lastFetchTime
				;(service as any).lastFetchTime = Date.now() - 61 * 60 * 1000 // 61 minutes ago

				httpGetStub.resetHistory()

				// Should make new API calls
				await service.fetchPromptsCatalog()

				assert.ok(httpGetStub.callCount > 0, "Should make API calls when cache is expired")
			})
		})
	})
})
