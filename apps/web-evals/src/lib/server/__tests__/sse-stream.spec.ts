// npx vitest run src/lib/server/__tests__/sse-stream.spec.ts

import { SSEStream } from "../sse-stream"

describe("SSEStream", () => {
	let stream: SSEStream

	beforeEach(() => {
		stream = new SSEStream()
	})

	it("should create a new SSEStream instance", () => {
		expect(stream).toBeInstanceOf(SSEStream)
		expect(stream.isClosed).toBe(false)
	})

	it("should write string data successfully when stream is open", async () => {
		const response = stream.getResponse()
		const reader = response.body?.getReader()

		const writePromise = stream.write("test message")

		if (reader) {
			await reader.read()
			reader.releaseLock()
		}

		const result = await writePromise
		expect(result).toBe(true)
		expect(stream.isClosed).toBe(false)
	})

	it("should write object data successfully when stream is open", async () => {
		const testData = { message: "test", id: 123 }

		const response = stream.getResponse()
		const reader = response.body?.getReader()

		const writePromise = stream.write(testData)

		if (reader) {
			await reader.read()
			reader.releaseLock()
		}

		const result = await writePromise
		expect(result).toBe(true)
		expect(stream.isClosed).toBe(false)
	})

	it("should return false when writing to closed stream", async () => {
		await stream.close()
		expect(stream.isClosed).toBe(true)

		const result = await stream.write("test message")
		expect(result).toBe(false)
	})

	it("should handle multiple close calls gracefully", async () => {
		await stream.close()
		expect(stream.isClosed).toBe(true)

		// Second close should not throw.
		await expect(stream.close()).resolves.toBeUndefined()
		expect(stream.isClosed).toBe(true)
	})

	it("should create response with correct headers", () => {
		const response = stream.getResponse()
		expect(response).toBeInstanceOf(Response)
		expect(response.headers.get("Content-Type")).toBe("text/event-stream")
		expect(response.headers.get("Connection")).toBe("keep-alive")
		expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform")
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
	})

	it("should format data correctly for SSE", async () => {
		const response = stream.getResponse()
		const reader = response.body?.getReader()
		const decoder = new TextDecoder()

		const writePromise = stream.write("hello world")

		if (reader) {
			const { value } = await reader.read()
			const text = decoder.decode(value)
			expect(text).toBe("data: hello world\n\n")
			reader.releaseLock()
		}

		await writePromise
	})

	it("should format JSON data correctly for SSE", async () => {
		const response = stream.getResponse()
		const reader = response.body?.getReader()
		const decoder = new TextDecoder()

		const testData = { type: "test", message: "hello" }
		const writePromise = stream.write(testData)

		if (reader) {
			const { value } = await reader.read()
			const text = decoder.decode(value)
			expect(text).toBe(`data: ${JSON.stringify(testData)}\n\n`)
			reader.releaseLock()
		}

		await writePromise
	})
})
