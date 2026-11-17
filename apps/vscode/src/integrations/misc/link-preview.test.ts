import { beforeEach, describe, expect, it, vi } from "vitest"
import { fetchOpenGraphData } from "./link-preview"

const ogsMock = vi.fn()

vi.mock("open-graph-scraper", () => ({
	default: (options: unknown) => ogsMock(options),
}))
vi.mock("@/shared/net", () => ({
	fetch: vi.fn(),
	getAxiosSettings: vi.fn(() => ({})),
}))
vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn() },
}))

function lastOptions(): any {
	return ogsMock.mock.calls.at(-1)![0]
}

function mockPage(result: Record<string, unknown>): void {
	ogsMock.mockResolvedValue({ error: false, result })
}

beforeEach(() => {
	ogsMock.mockReset()
	mockPage({ ogTitle: "Example" })
})

describe("fetchOpenGraphData", () => {
	it("gives open-graph-scraper options it actually reads", async () => {
		await fetchOpenGraphData("https://example.com/blog/post/")
		const options = lastOptions()
		// ogs 6.x takes seconds, so 5000 would mean a ~83 minute hang.
		expect(options.timeout).toBe(5)
		// ogs 6.x has no top-level `headers` or `fetch` option; only
		// `fetchOptions` is forwarded to its bundled undici fetch.
		expect(options.headers).toBeUndefined()
		expect(options.fetch).toBeUndefined()
		expect(options.fetchOptions.redirect).toBe("follow")
		expect(options.fetchOptions.headers["user-agent"]).toBe(
			"Mozilla/5.0 (compatible; VSCodeExtension/1.0; +https://cline.bot)",
		)
	})

	it.each([
		["./card.png", "https://example.com/blog/post/card.png"],
		["card.png", "https://example.com/blog/post/card.png"],
		["../card.png", "https://example.com/blog/card.png"],
		["/card.png", "https://example.com/card.png"],
		["https://cdn.example.com/card.png", "https://cdn.example.com/card.png"],
	])("resolves og:image %s against the page URL", async (image, expected) => {
		mockPage({ ogTitle: "Example", ogImage: [{ url: image }] })
		const data = await fetchOpenGraphData("https://example.com/blog/post/")
		expect(data.image).toBe(expected)
	})

	it("resolves against a page URL without a trailing slash", async () => {
		mockPage({ ogTitle: "Example", ogImage: [{ url: "./card.png" }] })
		const data = await fetchOpenGraphData("https://example.com/blog/post")
		expect(data.image).toBe("https://example.com/blog/card.png")
	})

	it("resolves relative twitter:image URLs the same way", async () => {
		mockPage({ twitterTitle: "Example", twitterImage: [{ url: "./card.png" }] })
		const data = await fetchOpenGraphData("https://example.com/blog/post/")
		expect(data.image).toBe("https://example.com/blog/post/card.png")
	})
})
