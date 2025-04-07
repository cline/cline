import { parseXml } from "../xml"

describe("parseXml", () => {
	describe("type conversion", () => {
		// Test the main change from the commit: no automatic type conversion
		it("should not convert string numbers to numbers", () => {
			const xml = `
        <root>
          <numericString>123</numericString>
          <negativeNumericString>-456</negativeNumericString>
          <floatNumericString>123.456</floatNumericString>
        </root>
      `

			const result = parseXml(xml) as any

			// Ensure these remain as strings and are not converted to numbers
			expect(typeof result.root.numericString).toBe("string")
			expect(result.root.numericString).toBe("123")

			expect(typeof result.root.negativeNumericString).toBe("string")
			expect(result.root.negativeNumericString).toBe("-456")

			expect(typeof result.root.floatNumericString).toBe("string")
			expect(result.root.floatNumericString).toBe("123.456")
		})

		it("should not convert string booleans to booleans", () => {
			const xml = `
        <root>
          <boolTrue>true</boolTrue>
          <boolFalse>false</boolFalse>
        </root>
      `

			const result = parseXml(xml) as any

			// Ensure these remain as strings and are not converted to booleans
			expect(typeof result.root.boolTrue).toBe("string")
			expect(result.root.boolTrue).toBe("true")

			expect(typeof result.root.boolFalse).toBe("string")
			expect(result.root.boolFalse).toBe("false")
		})

		it("should not convert attribute values to their respective types", () => {
			const xml = `
        <root>
          <node id="123" enabled="true" disabled="false" float="3.14" />
        </root>
      `

			const result = parseXml(xml) as any
			const attributes = result.root.node

			// Check that attributes remain as strings
			expect(typeof attributes["@_id"]).toBe("string")
			expect(attributes["@_id"]).toBe("123")

			expect(typeof attributes["@_enabled"]).toBe("string")
			expect(attributes["@_enabled"]).toBe("true")

			expect(typeof attributes["@_disabled"]).toBe("string")
			expect(attributes["@_disabled"]).toBe("false")

			expect(typeof attributes["@_float"]).toBe("string")
			expect(attributes["@_float"]).toBe("3.14")
		})
	})

	describe("basic functionality", () => {
		it("should correctly parse a simple XML string", () => {
			const xml = `
        <root>
          <name>Test Name</name>
          <description>Some description</description>
        </root>
      `

			const result = parseXml(xml) as any

			expect(result).toHaveProperty("root")
			expect(result.root).toHaveProperty("name", "Test Name")
			expect(result.root).toHaveProperty("description", "Some description")
		})

		it("should handle attributes correctly", () => {
			const xml = `
        <root>
          <item id="1" category="test">Item content</item>
        </root>
      `

			const result = parseXml(xml) as any

			expect(result.root.item).toHaveProperty("@_id", "1")
			expect(result.root.item).toHaveProperty("@_category", "test")
			expect(result.root.item).toHaveProperty("#text", "Item content")
		})

		it("should support stopNodes parameter", () => {
			const xml = `
        <root>
          <data>
            <nestedXml><item>Should not parse this</item></nestedXml>
          </data>
        </root>
      `

			const result = parseXml(xml, ["nestedXml"]) as any

			// With stopNodes, the parser still parses the structure but stops at the specified node
			expect(result.root.data.nestedXml).toBeTruthy()
			expect(result.root.data.nestedXml).toHaveProperty("item", "Should not parse this")
		})
	})

	describe("error handling", () => {
		it("wraps parser errors with a descriptive message", () => {
			// Use jest.spyOn to mock the XMLParser implementation
			const mockParseFn = jest.fn().mockImplementation(() => {
				throw new Error("Simulated parsing error")
			})

			const mockParserInstance = {
				parse: mockParseFn,
			}

			// Spy on the XMLParser constructor to return our mock
			const parserSpy = jest
				.spyOn(require("fast-xml-parser"), "XMLParser")
				.mockImplementation(() => mockParserInstance)

			// Test that our function wraps the error appropriately
			expect(() => parseXml("<root></root>")).toThrow("Failed to parse XML: Simulated parsing error")

			// Verify the parser was called with the expected options
			expect(parserSpy).toHaveBeenCalledWith({
				ignoreAttributes: false,
				attributeNamePrefix: "@_",
				parseAttributeValue: false,
				parseTagValue: false,
				trimValues: true,
				stopNodes: [],
			})

			// Cleanup
			parserSpy.mockRestore()
		})
	})
})
