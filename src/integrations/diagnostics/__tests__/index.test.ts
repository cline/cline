import { describe, it, beforeEach } from "mocha"
import { expect } from "chai"
import { getNewDiagnostics, diagnosticsToProblemsString } from "../"
import { DiagnosticSeverity, FileDiagnostics } from "@shared/proto/index.cline"
import * as sinon from "sinon"
import * as pathUtils from "@/utils/path"

describe("Diagnostics Tests", () => {
	describe("getNewDiagnostics", () => {
		it("should return empty array when both old and new diagnostics are empty", () => {
			const oldDiagnostics: FileDiagnostics[] = []
			const newDiagnostics: FileDiagnostics[] = []

			const result = getNewDiagnostics(oldDiagnostics, newDiagnostics)

			expect(result).to.deep.equal([])
		})

		it("should return all diagnostics when old diagnostics is empty", () => {
			const oldDiagnostics: FileDiagnostics[] = []
			const newDiagnostics: FileDiagnostics[] = [
				{
					filePath: "/path/to/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error in file1",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
						},
					],
				},
			]

			const result = getNewDiagnostics(oldDiagnostics, newDiagnostics)

			expect(result).to.deep.equal(newDiagnostics)
		})

		it("should return empty array when new diagnostics is empty", () => {
			const oldDiagnostics: FileDiagnostics[] = [
				{
					filePath: "/path/to/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error in file1",
						},
					],
				},
			]
			const newDiagnostics: FileDiagnostics[] = []

			const result = getNewDiagnostics(oldDiagnostics, newDiagnostics)

			expect(result).to.deep.equal([])
		})

		it("should return only new diagnostics not present in old diagnostics", () => {
			const oldDiagnostics: FileDiagnostics[] = [
				{
					filePath: "/path/to/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Old error",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
						},
					],
				},
			]
			const newDiagnostics: FileDiagnostics[] = [
				{
					filePath: "/path/to/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Old error",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
						},
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_WARNING,
							message: "New warning",
							range: {
								start: { line: 5, character: 5 },
								end: { line: 5, character: 15 },
							},
						},
					],
				},
			]

			const result = getNewDiagnostics(oldDiagnostics, newDiagnostics)

			expect(result).to.have.lengthOf(1)
			expect(result[0].filePath).to.equal("/path/to/file1.ts")
			expect(result[0].diagnostics).to.have.lengthOf(1)
			expect(result[0].diagnostics[0].message).to.equal("New warning")
		})

		it("should handle multiple files correctly", () => {
			const oldDiagnostics: FileDiagnostics[] = [
				{
					filePath: "/path/to/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error in file1",
						},
					],
				},
			]
			const newDiagnostics: FileDiagnostics[] = [
				{
					filePath: "/path/to/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error in file1",
						},
					],
				},
				{
					filePath: "/path/to/file2.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error in file2",
						},
					],
				},
			]

			const result = getNewDiagnostics(oldDiagnostics, newDiagnostics)

			expect(result).to.have.lengthOf(1)
			expect(result[0].filePath).to.equal("/path/to/file2.ts")
		})

		it("should handle diagnostics with source and code properties", () => {
			const oldDiagnostics: FileDiagnostics[] = []
			const newDiagnostics: FileDiagnostics[] = [
				{
					filePath: "/path/to/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Type error",
							source: "typescript",
							range: {
								start: { line: 10, character: 5 },
								end: { line: 10, character: 20 },
							},
						},
					],
				},
			]

			const result = getNewDiagnostics(oldDiagnostics, newDiagnostics)

			expect(result).to.deep.equal(newDiagnostics)
		})
	})

	describe("diagnosticsToProblemsString", () => {
		let getCwdStub: sinon.SinonStub

		beforeEach(() => {
			getCwdStub = sinon.stub(pathUtils, "getCwd").resolves("/workspace")
		})

		afterEach(() => {
			sinon.restore()
		})

		it("should return empty string when diagnostics array is empty", async () => {
			const diagnostics: FileDiagnostics[] = []
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal("")
		})

		it("should return empty string when no diagnostics match the severity filter", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_WARNING,
							message: "Warning message",
						},
					],
				},
			]
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal("")
		})

		it("should format error diagnostics correctly with line numbers", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Type error",
							range: {
								start: { line: 9, character: 5 },
								end: { line: 9, character: 20 },
							},
						},
					],
				},
			]
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal("src/file1.ts\n- [Error] Line 10: Type error")
		})

		it("should handle diagnostics without range information", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "File-level error",
						},
					],
				},
			]
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal("src/file1.ts\n- [Error] Line : File-level error")
		})

		it("should handle diagnostics with missing start property in range", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error with partial range",
							range: {} as any, // Simulating missing start property
						},
					],
				},
			]
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal("src/file1.ts\n- [Error] Line : Error with partial range")
		})

		it("should include source information when available", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Type error",
							source: "typescript",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
						},
					],
				},
			]
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal("src/file1.ts\n- [typescript Error] Line 1: Type error")
		})

		it("should handle multiple severities", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error message",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
						},
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_WARNING,
							message: "Warning message",
							range: {
								start: { line: 5, character: 0 },
								end: { line: 5, character: 10 },
							},
						},
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_INFORMATION,
							message: "Info message",
							range: {
								start: { line: 10, character: 0 },
								end: { line: 10, character: 10 },
							},
						},
					],
				},
			]
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR, DiagnosticSeverity.DIAGNOSTIC_WARNING]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal("src/file1.ts\n- [Error] Line 1: Error message\n- [Warning] Line 6: Warning message")
		})

		it("should handle multiple files", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error in file1",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
						},
					],
				},
				{
					filePath: "/workspace/src/file2.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error in file2",
							range: {
								start: { line: 5, character: 0 },
								end: { line: 5, character: 10 },
							},
						},
					],
				},
			]
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal(
				"src/file1.ts\n- [Error] Line 1: Error in file1\n\nsrc/file2.ts\n- [Error] Line 6: Error in file2",
			)
		})

		it("should handle absolute paths outside workspace", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/other/path/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error outside workspace",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
						},
					],
				},
			]
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal("../other/path/file1.ts\n- [Error] Line 1: Error outside workspace")
		})

		it("should handle all diagnostic severity types", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error",
							range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
						},
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_WARNING,
							message: "Warning",
							range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
						},
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_INFORMATION,
							message: "Information",
							range: { start: { line: 2, character: 0 }, end: { line: 2, character: 10 } },
						},
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_HINT,
							message: "Hint",
							range: { start: { line: 3, character: 0 }, end: { line: 3, character: 10 } },
						},
					],
				},
			]
			const severities = [
				DiagnosticSeverity.DIAGNOSTIC_ERROR,
				DiagnosticSeverity.DIAGNOSTIC_WARNING,
				DiagnosticSeverity.DIAGNOSTIC_INFORMATION,
				DiagnosticSeverity.DIAGNOSTIC_HINT,
			]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			expect(result).to.equal(
				"src/file1.ts\n- [Error] Line 1: Error\n- [Warning] Line 2: Warning\n- [Information] Line 3: Information\n- [Hint] Line 4: Hint",
			)
		})

		it("should handle edge case with line number 0", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error on first line",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
						},
					],
				},
			]
			const severities = [DiagnosticSeverity.DIAGNOSTIC_ERROR]

			const result = await diagnosticsToProblemsString(diagnostics, severities)

			// Line 0 should be displayed as Line 1 (1-indexed)
			expect(result).to.equal("src/file1.ts\n- [Error] Line 1: Error on first line")
		})

		it("should include all diagnostics when severities is undefined", async () => {
			const diagnostics: FileDiagnostics[] = [
				{
					filePath: "/workspace/src/file1.ts",
					diagnostics: [
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							message: "Error message",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
						},
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_WARNING,
							message: "Warning message",
							range: {
								start: { line: 1, character: 0 },
								end: { line: 1, character: 10 },
							},
						},
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_INFORMATION,
							message: "Info message",
							range: {
								start: { line: 2, character: 0 },
								end: { line: 2, character: 10 },
							},
						},
						{
							severity: DiagnosticSeverity.DIAGNOSTIC_HINT,
							message: "Hint message",
							range: {
								start: { line: 3, character: 0 },
								end: { line: 3, character: 10 },
							},
						},
					],
				},
			]

			// Call without severities parameter (undefined)
			const result = await diagnosticsToProblemsString(diagnostics)

			// Should include all diagnostics regardless of severity
			expect(result).to.equal(
				"src/file1.ts\n- [Error] Line 1: Error message\n- [Warning] Line 2: Warning message\n- [Information] Line 3: Info message\n- [Hint] Line 4: Hint message",
			)
		})
	})
})
