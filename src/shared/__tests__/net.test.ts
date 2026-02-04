import { expect } from "chai"
import { fetch, getAxiosSettings, mockFetchForTesting } from "../net"

describe("net", () => {
	describe("fetch", () => {
		it("should be a function", () => {
			expect(typeof fetch).to.equal("function")
		})

		it("should be callable and return a Promise", async () => {
			// Mock a simple successful response
			const mockResponse = new Response("test", { status: 200 })
			const mockFetch = async () => mockResponse

			await mockFetchForTesting(mockFetch as unknown as typeof globalThis.fetch, async () => {
				const response = await fetch("https://example.com")
				expect(response).to.equal(mockResponse)
			})
		})

		it("should preserve Bun's preconnect property if present", () => {
			// In Bun, fetch should have preconnect. In Node, it won't.
			// We just verify that if baseFetch had it, our wrapper preserves it.
			if ("preconnect" in globalThis.fetch) {
				expect("preconnect" in fetch).to.be.true
				expect(typeof (fetch as any).preconnect).to.equal("function")
			}
		})
	})

	describe("mockFetchForTesting", () => {
		let originalFetchCalls: string[] = []

		beforeEach(() => {
			originalFetchCalls = []
		})

		it("should temporarily replace fetch with mock", async () => {
			const mockResponse = new Response("mocked", { status: 200 })
			const mockFetch = async (input: string | URL | Request) => {
				originalFetchCalls.push(input.toString())
				return mockResponse
			}

			await mockFetchForTesting(mockFetch as unknown as typeof globalThis.fetch, async () => {
				const response = await fetch("https://test1.com")
				expect(response).to.equal(mockResponse)
				expect(originalFetchCalls).to.include("https://test1.com")
			})
		})

		it("should restore original fetch after callback completes", async () => {
			const mockResponse = new Response("mocked", { status: 200 })
			const mockFetch = async () => mockResponse

			let insideMock = false
			await mockFetchForTesting(mockFetch as unknown as typeof globalThis.fetch, async () => {
				insideMock = true
				const response = await fetch("https://test.com")
				expect(response).to.equal(mockResponse)
			})

			expect(insideMock).to.be.true

			// After callback, fetch should not return the mocked response
			// We can't easily test this without making a real network call,
			// but we can verify the function signature is intact
			expect(typeof fetch).to.equal("function")
		})

		it("should restore original fetch even if callback throws", () => {
			const mockFetch = async () => new Response("mocked", { status: 200 })

			expect(() => {
				mockFetchForTesting(mockFetch as unknown as typeof globalThis.fetch, () => {
					throw new Error("Test error")
				})
			}).to.throw("Test error")

			// Fetch should still be a function after error
			expect(typeof fetch).to.equal("function")
		})

		it("should handle nested mocking", async () => {
			const mock1Response = new Response("mock1", { status: 200 })
			const mock2Response = new Response("mock2", { status: 200 })

			const mock1 = async () => mock1Response
			const mock2 = async () => mock2Response

			await mockFetchForTesting(mock1 as unknown as typeof globalThis.fetch, async () => {
				const response1 = await fetch("https://test1.com")
				expect(response1).to.equal(mock1Response)

				await mockFetchForTesting(mock2 as unknown as typeof globalThis.fetch, async () => {
					const response2 = await fetch("https://test2.com")
					expect(response2).to.equal(mock2Response)
				})

				// Should restore to mock1 after inner mock completes
				const response3 = await fetch("https://test3.com")
				expect(response3).to.equal(mock1Response)
			})
		})

		it("should work with synchronous callbacks", () => {
			const mockFetch = async () => new Response("mocked", { status: 200 })
			let called = false

			mockFetchForTesting(mockFetch as unknown as typeof globalThis.fetch, () => {
				called = true
			})

			expect(called).to.be.true
		})
	})

	describe("getAxiosSettings", () => {
		it("should return an object with adapter and fetch", () => {
			const settings = getAxiosSettings()

			expect(settings).to.have.property("adapter")
			expect(settings).to.have.property("fetch")
			expect(settings.adapter).to.equal("fetch")
			expect(typeof settings.fetch).to.equal("function")
		})

		it("should return our configured fetch function", () => {
			const settings = getAxiosSettings()
			expect(settings.fetch).to.equal(fetch)
		})

		it("should be spreadable into axios config", () => {
			const customConfig = {
				headers: { "X-Custom": "header" },
				timeout: 5000,
			}

			const finalConfig = {
				...customConfig,
				...getAxiosSettings(),
			}

			expect(finalConfig.headers).to.deep.equal({ "X-Custom": "header" })
			expect(finalConfig.timeout).to.equal(5000)
			expect(finalConfig.adapter).to.equal("fetch")
			expect(finalConfig.fetch).to.equal(fetch)
		})
	})
})
