import { CodeParser } from "../parser"

// Mock TelemetryService
vi.mock("../../../../../packages/telemetry/src/TelemetryService", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

import { shouldUseFallbackChunking } from "../../shared/supported-extensions"

describe("CodeParser - VB.NET and Fallback Extensions Support", () => {
	let parser: CodeParser

	beforeEach(() => {
		parser = new CodeParser()
	})

	it("should use fallback chunking for VB.NET files", async () => {
		// First verify that shouldUseFallbackChunking works
		expect(shouldUseFallbackChunking(".vb")).toBe(true)

		const vbContent = `
Imports System
Imports System.Collections.Generic
Imports System.Linq

Namespace MyApplication
    Public Class Calculator
        Private _history As New List(Of String)()

        Public Function Add(a As Integer, b As Integer) As Integer
            Dim result As Integer = a + b
            _history.Add($"{a} + {b} = {result}")
            Return result
        End Function

        Public Function Subtract(a As Integer, b As Integer) As Integer
            Dim result As Integer = a - b
            _history.Add($"{a} - {b} = {result}")
            Return result
        End Function

        Public Function Multiply(a As Integer, b As Integer) As Integer
            Dim result As Integer = a * b
            _history.Add($"{a} * {b} = {result}")
            Return result
        End Function

        Public Function Divide(a As Integer, b As Integer) As Double
            If b = 0 Then
                Throw New DivideByZeroException("Cannot divide by zero")
            End If
            Dim result As Double = CDbl(a) / CDbl(b)
            _history.Add($"{a} / {b} = {result}")
            Return result
        End Function

        Public Function GetHistory() As List(Of String)
            Return New List(Of String)(_history)
        End Function

        Public Sub ClearHistory()
            _history.Clear()
        End Sub
    End Class

    Public Module Program
        Sub Main(args As String())
            Dim calc As New Calculator()
            
            Console.WriteLine("Calculator Demo")
            Console.WriteLine("===============")
            
            Console.WriteLine($"10 + 5 = {calc.Add(10, 5)}")
            Console.WriteLine($"10 - 5 = {calc.Subtract(10, 5)}")
            Console.WriteLine($"10 * 5 = {calc.Multiply(10, 5)}")
            Console.WriteLine($"10 / 5 = {calc.Divide(10, 5)}")
            
            Console.WriteLine()
            Console.WriteLine("History:")
            For Each entry In calc.GetHistory()
                Console.WriteLine($"  {entry}")
            Next
        End Sub
    End Module
End Namespace
`.trim()

		const result = await parser.parseFile("test.vb", {
			content: vbContent,
			fileHash: "test-hash",
		})

		// Should have results from fallback chunking
		expect(result.length).toBeGreaterThan(0)

		// Check that all blocks are of type 'fallback_chunk'
		result.forEach((block) => {
			expect(block.type).toBe("fallback_chunk")
		})

		// Verify content is properly chunked
		const totalContent = result.map((block) => block.content).join("\n")
		expect(totalContent).toBe(vbContent)

		// Verify file path is correct
		expect(result[0].file_path).toBe("test.vb")
	})

	it("should handle large VB.NET files with proper chunking", async () => {
		// Create a large VB.NET file content
		const largeVbContent =
			`
Imports System
Imports System.Collections.Generic

Namespace LargeApplication
` +
			// Generate many classes to create a large file
			Array.from(
				{ length: 50 },
				(_, i) => `
    Public Class TestClass${i}
        Private _id As Integer = ${i}
        Private _name As String = "Class ${i}"
        Private _data As New Dictionary(Of String, Object)()

        Public Property Id As Integer
            Get
                Return _id
            End Get
            Set(value As Integer)
                _id = value
            End Set
        End Property

        Public Property Name As String
            Get
                Return _name
            End Get
            Set(value As String)
                _name = value
            End Set
        End Property

        Public Sub ProcessData()
            For i As Integer = 0 To 100
                _data.Add($"key_{i}", $"value_{i}")
            Next
        End Sub

        Public Function GetData() As Dictionary(Of String, Object)
            Return New Dictionary(Of String, Object)(_data)
        End Function
    End Class
`,
			).join("\n") +
			`
End Namespace
`

		const result = await parser.parseFile("large-test.vb", {
			content: largeVbContent,
			fileHash: "large-test-hash",
		})

		// Should have multiple chunks due to size
		expect(result.length).toBeGreaterThan(1)

		// All chunks should be fallback chunks
		result.forEach((block) => {
			expect(block.type).toBe("fallback_chunk")
		})

		// Verify chunks don't exceed max size
		result.forEach((block) => {
			expect(block.content.length).toBeLessThanOrEqual(150000) // MAX_BLOCK_CHARS * MAX_CHARS_TOLERANCE_FACTOR
		})
	})

	it("should handle empty VB.NET files", async () => {
		const emptyContent = ""

		const result = await parser.parseFile("empty.vb", {
			content: emptyContent,
			fileHash: "empty-hash",
		})

		// Should return empty array for empty content
		expect(result).toEqual([])
	})

	it("should handle small VB.NET files below minimum chunk size", async () => {
		const smallContent = "Imports System"

		const result = await parser.parseFile("small.vb", {
			content: smallContent,
			fileHash: "small-hash",
		})

		// Should return empty array for content below MIN_BLOCK_CHARS
		expect(result).toEqual([])
	})

	it("should use fallback chunking for other configured fallback extensions", async () => {
		// Test with Scala which is in our fallback list
		const content = `object ScalaExample {
			def main(args: Array[String]): Unit = {
				println("This is a Scala file that should use fallback chunking")
				val numbers = List(1, 2, 3, 4, 5)
				val doubled = numbers.map(_ * 2)
				println(s"Doubled numbers: $doubled")
			}
			
			def factorial(n: Int): Int = {
				if (n <= 1) 1
				else n * factorial(n - 1)
			}
		}`

		const result = await parser.parseFile("test.scala", {
			content: content,
			fileHash: "test-hash-scala",
		})

		// Should have results from fallback chunking
		expect(result.length).toBeGreaterThan(0)

		// Check that all blocks are of type 'fallback_chunk'
		result.forEach((block) => {
			expect(block.type).toBe("fallback_chunk")
		})
	})
})

describe("Fallback Extensions Configuration", () => {
	it("should correctly identify extensions that need fallback chunking", () => {
		// Extensions that should use fallback
		expect(shouldUseFallbackChunking(".vb")).toBe(true)
		expect(shouldUseFallbackChunking(".scala")).toBe(true)
		expect(shouldUseFallbackChunking(".swift")).toBe(true)

		// Extensions that should not use fallback (have working parsers)
		expect(shouldUseFallbackChunking(".js")).toBe(false)
		expect(shouldUseFallbackChunking(".ts")).toBe(false)
		expect(shouldUseFallbackChunking(".py")).toBe(false)
		expect(shouldUseFallbackChunking(".java")).toBe(false)
		expect(shouldUseFallbackChunking(".cs")).toBe(false)
		expect(shouldUseFallbackChunking(".go")).toBe(false)
		expect(shouldUseFallbackChunking(".rs")).toBe(false)
	})

	it("should be case-insensitive", () => {
		expect(shouldUseFallbackChunking(".VB")).toBe(true)
		expect(shouldUseFallbackChunking(".Vb")).toBe(true)
		expect(shouldUseFallbackChunking(".SCALA")).toBe(true)
		expect(shouldUseFallbackChunking(".Scala")).toBe(true)
	})
})
