import { expect } from "chai"
import * as toolExports from "../index"

describe("Tool Descriptions", () => {
	it("should ensure all tool variants have non-empty descriptions", () => {
		const allVariants: any[] = []

		for (const key of Object.keys(toolExports)) {
			if (key.endsWith("_variants")) {
				const variants = (toolExports as any)[key]
				if (Array.isArray(variants)) {
					allVariants.push(...variants)
				}
			}
		}

		expect(allVariants.length).to.be.greaterThan(0, "Should find at least one tool variant")

		for (const variant of allVariants) {
			const { name, description } = variant
			expect(description, `Tool "${name}" must have a non-empty description (AWS Bedrock requires min length 1)`).to.be.a(
				"string",
			)
			expect(
				description.trim().length,
				`Tool "${name}" description must not be empty or whitespace-only (AWS Bedrock requires min length 1)`,
			).to.be.greaterThan(0)
		}
	})
})
