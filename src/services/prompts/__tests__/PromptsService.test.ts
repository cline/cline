import * as assert from "assert"
import * as sinon from "sinon"
import { PromptsService } from "@/services/prompts/PromptsService"

/**
 * Helper: builds a mock Git Tree API response.
 */
function mockTreeResponse(entries: Array<{ path: string; type?: string }>) {
	return {
		data: {
			sha: "abc123",
			url: "https://api.github.com/repos/cline/prompts/git/trees/main",
			tree: entries.map((e) => ({
				path: e.path,
				mode: "100644",
				type: e.type || "blob",
				sha: "def456",
				url: `https://api.github.com/repos/cline/prompts/git/blobs/def456`,
			})),
			truncated: false,
		},
	}
}

/**
 * Helper: builds markdown content with YAML frontmatter.
 */
function makeMarkdown(frontmatter: Record<string, unknown>, body = "# Content"): string {
	const yamlLines: string[] = []
	for (const [key, value] of Object.entries(frontmatter)) {
		if (Array.isArray(value)) {
			yamlLines.push(`${key}: ${JSON.stringify(value)}`)
		} else if (typeof value === "string" && value.includes('"')) {
			yamlLines.push(`${key}: '${value}'`)
		} else {
			yamlLines.push(`${key}: ${value}`)
		}
	}
	return `---\n${yamlLines.join("\n")}\n---\n${body}`
}

describe("PromptsService", () => {
	let service: PromptsService
	let httpGetStub: sinon.SinonStub
	let fetchRawContentStub: sinon.SinonStub

	beforeEach(() => {
		service = new PromptsService()
		httpGetStub = sinon.stub(service as any, "httpGet")
		fetchRawContentStub = sinon.stub(service as any, "fetchRawContent")
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("fetchPromptsCatalog", () => {
		describe("Frontmatter Parsing", () => {
			it("should parse author, version, and description from frontmatter", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/test-prompt.md" }]))
				fetchRawContentStub.resolves(
					makeMarkdown({
						description: "Test description",
						author: "testuser",
						version: "1.0",
						category: "Testing",
						tags: ["tag1", "tag2"],
					}),
				)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 1)
				assert.strictEqual(catalog.items[0].description, "Test description")
				assert.strictEqual(catalog.items[0].author, "testuser")
				assert.strictEqual(catalog.items[0].version, "1.0")
				assert.strictEqual(catalog.items[0].category, "Testing")
				assert.deepStrictEqual(catalog.items[0].tags, ["tag1", "tag2"])
			})

			it("should extract GitHub username from author URL", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/github-author.md" }]))
				fetchRawContentStub.resolves(
					makeMarkdown({
						description: "Test",
						author: "https://github.com/octocat",
					}),
				)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].author, "octocat")
			})

			it("should handle non-URL author string as-is", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/plain-author.md" }]))
				fetchRawContentStub.resolves(
					makeMarkdown({
						description: "Test",
						author: "John Doe",
					}),
				)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].author, "John Doe")
			})

			it("should default author to Unknown when not in frontmatter", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/no-author.md" }]))
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].author, "Unknown")
			})

			it("should handle numeric version in frontmatter", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/numeric-ver.md" }]))
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test", version: 1.1 }))

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].version, "1.1")
			})

			it("should return empty version when not in frontmatter", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/no-ver.md" }]))
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].version, "")
			})

			it("should default description when missing from frontmatter", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/no-desc.md" }]))
				fetchRawContentStub.resolves("---\nauthor: test\n---\n# Content")

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].description, "No description available")
			})

			it("should default category to General when missing", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/no-cat.md" }]))
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].category, "General")
			})

			it("should handle files with no frontmatter at all", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/bare.md" }]))
				fetchRawContentStub.resolves("# Just a heading\n\nSome content.")

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 1)
				assert.strictEqual(catalog.items[0].author, "Unknown")
				assert.strictEqual(catalog.items[0].version, "")
				assert.strictEqual(catalog.items[0].description, "No description available")
			})

			it("should include full content for apply functionality", async () => {
				const fullContent = makeMarkdown({ description: "Test" }, "# Full Body\nLine 2")
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/with-content.md" }]))
				fetchRawContentStub.resolves(fullContent)

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items[0].content, fullContent)
			})
		})

		describe("Directory Type Mapping", () => {
			it("should map files in different directories to correct types", async () => {
				httpGetStub.resolves(
					mockTreeResponse([
						{ path: ".clinerules/rule-file.md" },
						{ path: "workflows/workflow-file.md" },
						{ path: "hooks/hook-file.md" },
						{ path: "skills/skill-file.md" },
					]),
				)
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 4)
				assert.strictEqual(catalog.items.find((i) => i.promptId === "rule-file")?.type, "rule")
				assert.strictEqual(catalog.items.find((i) => i.promptId === "workflow-file")?.type, "workflow")
				assert.strictEqual(catalog.items.find((i) => i.promptId === "hook-file")?.type, "hook")
				assert.strictEqual(catalog.items.find((i) => i.promptId === "skill-file")?.type, "skill")
			})

			it("should ignore files not in known directories", async () => {
				httpGetStub.resolves(
					mockTreeResponse([
						{ path: "README.md" },
						{ path: ".clinerules/valid.md" },
						{ path: "unknown-dir/unknown.md" },
					]),
				)
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 1)
				assert.strictEqual(catalog.items[0].promptId, "valid")
			})

			it("should ignore non-blob entries (directories)", async () => {
				httpGetStub.resolves(
					mockTreeResponse([
						{ path: ".clinerules", type: "tree" },
						{ path: ".clinerules/valid.md", type: "blob" },
					]),
				)
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 1)
			})
		})

		describe("API Efficiency", () => {
			it("should make exactly 1 API call for tree + N CDN calls for content", async () => {
				httpGetStub.resolves(
					mockTreeResponse([
						{ path: ".clinerules/file1.md" },
						{ path: ".clinerules/file2.md" },
						{ path: "workflows/file3.md" },
					]),
				)
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				await service.fetchPromptsCatalog()

				assert.strictEqual(httpGetStub.callCount, 1, "Should make exactly 1 API call for the tree")
				assert.strictEqual(fetchRawContentStub.callCount, 3, "Should fetch content for each markdown file")
			})
		})

		describe("Error Handling", () => {
			it("should return empty catalog on network error", async () => {
				httpGetStub.rejects(new Error("Network error"))

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
				assert.ok(catalog.lastUpdated)
			})

			it("should skip individual files that fail to fetch", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/good.md" }, { path: ".clinerules/bad.md" }]))
				fetchRawContentStub
					.onFirstCall()
					.resolves(makeMarkdown({ description: "Good file" }))
					.onSecondCall()
					.rejects(new Error("CDN error"))

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 1)
				assert.strictEqual(catalog.items[0].promptId, "good")
			})

			it("should handle empty tree response", async () => {
				httpGetStub.resolves({ data: { tree: [] } })

				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(catalog.items.length, 0)
			})
		})

		describe("GitHub Token Authentication", () => {
			it("should pass auth header when token is available", async () => {
				// Stub resolveGitHubToken to return a token
				sinon.stub(service as any, "resolveGitHubToken").returns("test-token-123")

				// Restore httpGet so we can verify the call args
				httpGetStub.restore()
				httpGetStub = sinon.stub(service as any, "httpGet")
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/test.md" }]))
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				await service.fetchPromptsCatalog()

				assert.ok(httpGetStub.calledOnce)
				const headers = httpGetStub.firstCall.args[1]
				assert.strictEqual(headers?.Authorization, "token test-token-123")
			})

			it("should not pass auth header when no token is available", async () => {
				// Stub resolveGitHubToken to return null
				sinon.stub(service as any, "resolveGitHubToken").returns(null)

				httpGetStub.restore()
				httpGetStub = sinon.stub(service as any, "httpGet")
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/test.md" }]))
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				await service.fetchPromptsCatalog()

				assert.ok(httpGetStub.calledOnce)
				const headers = httpGetStub.firstCall.args[1]
				assert.strictEqual(headers?.Authorization, undefined)
			})

			it("should check GITHUB_TOKEN env var for token resolution", () => {
				const originalToken = process.env.GITHUB_TOKEN
				try {
					process.env.GITHUB_TOKEN = "env-token-456"
					// Reset cached token
					;(service as any).cachedGitHubToken = undefined

					const token = (service as any).resolveGitHubToken()
					assert.strictEqual(token, "env-token-456")
				} finally {
					if (originalToken !== undefined) {
						process.env.GITHUB_TOKEN = originalToken
					} else {
						delete process.env.GITHUB_TOKEN
					}
				}
			})

			it("should check GH_TOKEN env var as fallback", () => {
				const originalGH = process.env.GH_TOKEN
				const originalGITHUB = process.env.GITHUB_TOKEN
				try {
					delete process.env.GITHUB_TOKEN
					process.env.GH_TOKEN = "gh-token-789"
					;(service as any).cachedGitHubToken = undefined

					const token = (service as any).resolveGitHubToken()
					assert.strictEqual(token, "gh-token-789")
				} finally {
					if (originalGITHUB !== undefined) {
						process.env.GITHUB_TOKEN = originalGITHUB
					} else {
						delete process.env.GITHUB_TOKEN
					}
					if (originalGH !== undefined) {
						process.env.GH_TOKEN = originalGH
					} else {
						delete process.env.GH_TOKEN
					}
				}
			})

			it("should cache resolved token", () => {
				;(service as any).cachedGitHubToken = "cached-token"
				const token = (service as any).resolveGitHubToken()
				assert.strictEqual(token, "cached-token")
			})
		})

		describe("Caching Behavior", () => {
			it("should cache results after first fetch", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/test.md" }]))
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				await service.fetchPromptsCatalog()

				httpGetStub.resetHistory()
				fetchRawContentStub.resetHistory()
				const catalog = await service.fetchPromptsCatalog()

				assert.strictEqual(httpGetStub.callCount, 0, "Should not make API calls when cache is fresh")
				assert.strictEqual(fetchRawContentStub.callCount, 0, "Should not fetch content when cache is fresh")
				assert.strictEqual(catalog.items.length, 1)
			})

			it("should refetch after cache expiration (1 hour)", async () => {
				httpGetStub.resolves(mockTreeResponse([{ path: ".clinerules/test.md" }]))
				fetchRawContentStub.resolves(makeMarkdown({ description: "Test" }))

				await service.fetchPromptsCatalog()

				// Manually expire cache
				;(service as any).lastFetchTime = Date.now() - 61 * 60 * 1000

				httpGetStub.resetHistory()
				fetchRawContentStub.resetHistory()

				await service.fetchPromptsCatalog()

				assert.ok(httpGetStub.callCount > 0, "Should make API calls when cache is expired")
			})
		})
	})
})
