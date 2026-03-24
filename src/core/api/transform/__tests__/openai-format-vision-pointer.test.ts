/**
 * Mocha/Chai unit tests for Glazyr zero-copy vision pointer detection in openai-format.ts
 */
import { expect } from "chai"
import { convertToOpenAiMessages } from "../openai-format"

const makeImageMessage = (data: string, mediaType = "image/webp") => ({
	role: "user" as const,
	content: [
		{
			type: "image" as const,
			source: { data, media_type: mediaType },
		},
	],
})

describe("openai-format – Glazyr zero-copy vision pointer detection", () => {
	it("passes a https:// vision pointer URL directly as image_url without a data: prefix", () => {
		const pointer = "https://mcp.glazyr.com/buffer/abc123"
		const result = convertToOpenAiMessages([makeImageMessage(pointer)])
		const content = (result[0] as any).content as any[]
		expect(content).to.have.lengthOf(1)
		expect(content[0].type).to.equal("image_url")
		expect(content[0].image_url.url).to.equal(pointer)
		expect(content[0].image_url.url).to.not.match(/^data:/)
	})

	it("wraps a base64 string in the data: URI format", () => {
		const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ=="
		const result = convertToOpenAiMessages([makeImageMessage(b64, "image/png")])
		const content = (result[0] as any).content as any[]
		expect(content[0].type).to.equal("image_url")
		expect(content[0].image_url.url).to.match(/^data:image\/png;base64,/)
	})

	it("also detects http:// pointers (non-TLS environments)", () => {
		const pointer = "http://localhost:8080/buffer/xyz"
		const result = convertToOpenAiMessages([makeImageMessage(pointer)])
		const content = (result[0] as any).content as any[]
		expect(content[0].image_url.url).to.equal(pointer)
	})
})
