import { readModelsFileSync, writeModelsFileSync } from "@cline/core"
import { describe, expect, it } from "vitest"

type StoredModelsFile = ReturnType<typeof readModelsFileSync>

const firstPath = "/tmp/first-models.json"
const secondPath = "/tmp/second-models.json"

const storedModelsFile = (): StoredModelsFile => ({
	version: 1,
	providers: {
		"openai-compatible": {
			models: {
				custom: { name: "Custom", capabilities: ["tools"] },
			},
		},
	},
})

describe("cline core model-file test stub", () => {
	it("isolates paths and returns defensive copies", () => {
		const input = storedModelsFile()
		writeModelsFileSync(firstPath, input)

		input.providers["openai-compatible"].models!.custom.name = "mutated input"
		const firstRead = readModelsFileSync(firstPath)
		firstRead.providers["openai-compatible"].models!.custom.name = "mutated read"

		expect(readModelsFileSync(firstPath)).toEqual(storedModelsFile())
		expect(readModelsFileSync(secondPath)).toEqual({ version: 1, providers: {} })
	})

	it("cannot observe model writes from the preceding test", () => {
		expect(readModelsFileSync(firstPath)).toEqual({ version: 1, providers: {} })
	})
})
