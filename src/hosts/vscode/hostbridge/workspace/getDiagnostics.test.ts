import { expect } from "chai"
import { describe, it } from "mocha"
import * as vscode from "vscode"
import { DiagnosticSeverity } from "@/shared/proto/index.cline"
import { convertToFileDiagnostics, convertVscodeDiagnostics } from "./getDiagnostics"

describe("getDiagnostics conversion functions", () => {
	describe("convertToFileDiagnostics", () => {
		it("should return empty array when no diagnostics are provided", () => {
			const vscodeDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = []

			const result = convertToFileDiagnostics(vscodeDiagnostics)

			expect(result).to.deep.equal([])
		})

		it("should skip files with empty diagnostics arrays", () => {
			const vscodeDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [
				[vscode.Uri.file("/path/to/file1.ts"), []],
				[
					vscode.Uri.file("/path/to/file2.ts"),
					[new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "Error message", vscode.DiagnosticSeverity.Error)],
				],
			]

			const result = convertToFileDiagnostics(vscodeDiagnostics)

			expect(result).to.deep.equal([
				{
					filePath: "/path/to/file2.ts",
					diagnostics: [
						{
							message: "Error message",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							source: undefined,
						},
					],
				},
			])
		})

		it("should convert multiple files with diagnostics", () => {
			const vscodeDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [
				[
					vscode.Uri.file("/path/to/file1.ts"),
					[new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "Error in file1", vscode.DiagnosticSeverity.Error)],
				],
				[
					vscode.Uri.file("/path/to/file2.ts"),
					[new vscode.Diagnostic(new vscode.Range(5, 5, 5, 15), "Warning in file2", vscode.DiagnosticSeverity.Warning)],
				],
			]

			const result = convertToFileDiagnostics(vscodeDiagnostics)

			expect(result).to.deep.equal([
				{
					filePath: "/path/to/file1.ts",
					diagnostics: [
						{
							message: "Error in file1",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 10 },
							},
							severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
							source: undefined,
						},
					],
				},
				{
					filePath: "/path/to/file2.ts",
					diagnostics: [
						{
							message: "Warning in file2",
							range: {
								start: { line: 5, character: 5 },
								end: { line: 5, character: 15 },
							},
							severity: DiagnosticSeverity.DIAGNOSTIC_WARNING,
							source: undefined,
						},
					],
				},
			])
		})
	})

	describe("convertVscodeDiagnostics", () => {
		it("should convert empty array", () => {
			const vscodeDiagnostics: vscode.Diagnostic[] = []

			const result = convertVscodeDiagnostics(vscodeDiagnostics)

			expect(result).to.deep.equal([])
		})

		it("should convert error diagnostic with source", () => {
			const vscodeDiagnostic = new vscode.Diagnostic(
				new vscode.Range(10, 5, 10, 20),
				"Type error",
				vscode.DiagnosticSeverity.Error,
			)
			vscodeDiagnostic.source = "typescript"

			const result = convertVscodeDiagnostics([vscodeDiagnostic])

			expect(result).to.deep.equal([
				{
					message: "Type error",
					range: {
						start: { line: 10, character: 5 },
						end: { line: 10, character: 20 },
					},
					severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
					source: "typescript",
				},
			])
		})

		it("should convert all severity types correctly", () => {
			const diagnostics = [
				new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "Error", vscode.DiagnosticSeverity.Error),
				new vscode.Diagnostic(new vscode.Range(1, 0, 1, 10), "Warning", vscode.DiagnosticSeverity.Warning),
				new vscode.Diagnostic(new vscode.Range(2, 0, 2, 10), "Information", vscode.DiagnosticSeverity.Information),
				new vscode.Diagnostic(new vscode.Range(3, 0, 3, 10), "Hint", vscode.DiagnosticSeverity.Hint),
			]

			const result = convertVscodeDiagnostics(diagnostics)

			expect(result).to.deep.equal([
				{
					message: "Error",
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 10 },
					},
					severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
					source: undefined,
				},
				{
					message: "Warning",
					range: {
						start: { line: 1, character: 0 },
						end: { line: 1, character: 10 },
					},
					severity: DiagnosticSeverity.DIAGNOSTIC_WARNING,
					source: undefined,
				},
				{
					message: "Information",
					range: {
						start: { line: 2, character: 0 },
						end: { line: 2, character: 10 },
					},
					severity: DiagnosticSeverity.DIAGNOSTIC_INFORMATION,
					source: undefined,
				},
				{
					message: "Hint",
					range: {
						start: { line: 3, character: 0 },
						end: { line: 3, character: 10 },
					},
					severity: DiagnosticSeverity.DIAGNOSTIC_HINT,
					source: undefined,
				},
			])
		})

		it("should handle diagnostic without source", () => {
			const vscodeDiagnostic = new vscode.Diagnostic(
				new vscode.Range(0, 0, 0, 10),
				"Simple error",
				vscode.DiagnosticSeverity.Error,
			)

			const result = convertVscodeDiagnostics([vscodeDiagnostic])

			expect(result).to.deep.equal([
				{
					message: "Simple error",
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 10 },
					},
					severity: DiagnosticSeverity.DIAGNOSTIC_ERROR,
					source: undefined,
				},
			])
		})
	})
})
