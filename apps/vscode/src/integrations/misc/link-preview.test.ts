import { describe, expect, it } from "bun:test"
import { mockFetchForTesting } from "@/shared/net"
import { fetchOpenGraphData } from "./link-preview"

function htmlResponse(html: string, url: string, status = 200): Response {
	const response = new Response(html, {
		status,
		headers: { "content-type": "text/html; charset=utf-8" },
	})
	Object.defineProperty(response, "url", { value: url })
	return response
}

describe("fetchOpenGraphData", () => {
	it("fetches through shared net and extracts common metadata", async () => {
		const fetchCalls: Array<{ input: string; init?: RequestInit }> = []
		const result = await mockFetchForTesting(
			async (input, init) => {
				fetchCalls.push({ input: String(input), init })
				return htmlResponse(
					`<!doctype html>
				<title>Document title</title>
				<meta property="og:title" content="Open Graph title">
				<meta property="og:description" content="Open Graph description">
				<meta property="og:image" content="../assets/card.png">
				<meta property="og:url" content="https://canonical.example/article">
				<meta property="og:site_name" content="Example">
				<meta property="og:type" content="article">`,
					"https://redirected.example/news/story",
				)
			},
			() => fetchOpenGraphData("https://original.example/story"),
		)

		expect(fetchCalls).toHaveLength(1)
		expect(fetchCalls[0]?.input).toBe("https://original.example/story")
		expect(fetchCalls[0]?.init?.redirect).toBe("follow")
		expect(result).toEqual({
			title: "Open Graph title",
			description: "Open Graph description",
			image: "https://redirected.example/assets/card.png",
			url: "https://canonical.example/article",
			siteName: "Example",
			type: "article",
		})
	})

	it("falls back to document metadata when Open Graph tags are absent", async () => {
		const result = await mockFetchForTesting(
			async () =>
				htmlResponse(
					`<title>Fallback title</title>
					<meta name="description" content="Fallback description">`,
					"https://docs.example/page",
				),
			() => fetchOpenGraphData("https://docs.example/page"),
		)

		expect(result).toEqual({
			title: "Fallback title",
			description: "Fallback description",
			image: undefined,
			url: "https://docs.example/page",
			siteName: "docs.example",
			type: undefined,
		})
	})

	it("returns URL-derived metadata when fetching fails", async () => {
		const result = await mockFetchForTesting(
			async () => {
				throw new Error("network unavailable")
			},
			() => fetchOpenGraphData("https://offline.example/article"),
		)

		expect(result).toEqual({
			title: "offline.example",
			description: "https://offline.example/article",
			url: "https://offline.example/article",
			siteName: "offline.example",
		})
	})
})
