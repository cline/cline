/**
 * Mocha/Chai unit tests for Glazyr zero-copy vision pointer detection in openai-format.ts
 */

import { Anthropic } from "@anthropic-ai/sdk"
import { expect } from "chai"
import { formatResponse } from "../../prompts/responses"
import { convertToOpenAiMessages } from "../openai-format"

const makeUserMessageFromToolResult = (images: string[]) => {
	// 1. Simulate the exact flow from BrowserSession -> BrowserToolHandler -> responses.ts
	const blocks = formatResponse.toolResult("Browser action complete", images, undefined) as Array<
		Anthropic.TextBlockParam | Anthropic.ImageBlockParam
	>

	// 2. Wrap it in a Cline message representation
	return {
		role: "user" as const,
		content: blocks,
	}
}

describe("openai-format – Glazyr zero-copy vision pointer detection", () => {
	it("passes a https:// vision pointer URL securely through the entire pipeline", () => {
		const pointer = "https://mcp.glazyr.com/buffer/abc123"

		// The pointer starts as a string array passed exactly like it came from BrowserSession.screenshot
		const message = makeUserMessageFromToolResult([pointer])
		const result = convertToOpenAiMessages([message])
		const content = (result[0] as any).content as any[]

		// Ensure text was preserved
		expect(content[0].text).to.equal("Browser action complete")

		// Ensure the image URL bypass was completely successful
		expect(content[1].type).to.equal("image_url")
		expect(content[1].image_url.url).to.equal(pointer)
		expect(content[1].image_url.url).to.not.match(/^data:/)
	})

	it("correctly parses and splits a standard Puppeteer base64 string", () => {
		const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ=="
		const dataUriUrl = `data:image/png;base64,${b64}`

		const message = makeUserMessageFromToolResult([dataUriUrl])
		const result = convertToOpenAiMessages([message])
		const content = (result[0] as any).content as any[]

		expect(content[1].type).to.equal("image_url")
		// The data URI should be perfectly reconstructed downstream by openai-format.ts
		expect(content[1].image_url.url).to.equal(dataUriUrl)
	})

	it("also allows http:// pointers for non-TLS edge development environments", () => {
		const pointer = "http://localhost:8080/buffer/xyz"

		const message = makeUserMessageFromToolResult([pointer])
		const result = convertToOpenAiMessages([message])
		const content = (result[0] as any).content as any[]

		expect(content[1].image_url.url).to.equal(pointer)
	})
})
