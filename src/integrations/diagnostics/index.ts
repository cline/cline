import * as vscode from "vscode"
import * as path from "path"
import deepEqual from "fast-deep-equal"
import { getCwd } from "@/utils/path"
import { HostProvider } from "@/hosts/host-provider"
import { GetDiagnosticsRequest, DiagnosticSeverity } from "@/shared/proto/host/diff"
import { Metadata } from "@/shared/proto/cline/common"

// Type alias for compatibility
export type DiagnosticTuple = [vscode.Uri, vscode.Diagnostic[]]

/**
 * Get all diagnostics from the host bridge
 */
export async function getAllDiagnostics(): Promise<DiagnosticTuple[]> {
	const response = await HostProvider.diff.getDiagnostics(
		GetDiagnosticsRequest.create({
			metadata: Metadata.create({}),
		}),
	)

	const result: DiagnosticTuple[] = []

	for (const fileDiagnostics of response.fileDiagnostics) {
		if (fileDiagnostics.diagnostics.length > 0) {
			const uri = vscode.Uri.file(fileDiagnostics.filePath)
			const diagnostics: vscode.Diagnostic[] = fileDiagnostics.diagnostics.map((d) => {
				// Convert proto severity back to VS Code severity
				let severity: vscode.DiagnosticSeverity
				switch (d.severity) {
					case DiagnosticSeverity.DIAGNOSTIC_ERROR:
						severity = vscode.DiagnosticSeverity.Error
						break
					case DiagnosticSeverity.DIAGNOSTIC_WARNING:
						severity = vscode.DiagnosticSeverity.Warning
						break
					case DiagnosticSeverity.DIAGNOSTIC_INFORMATION:
						severity = vscode.DiagnosticSeverity.Information
						break
					case DiagnosticSeverity.DIAGNOSTIC_HINT:
						severity = vscode.DiagnosticSeverity.Hint
						break
					default:
						severity = vscode.DiagnosticSeverity.Error
				}

				return new vscode.Diagnostic(
					new vscode.Range(
						new vscode.Position(d.range?.start?.line || 0, d.range?.start?.character || 0),
						new vscode.Position(d.range?.end?.line || 0, d.range?.end?.character || 0),
					),
					d.message,
					severity,
				)
			})

			result.push([uri, diagnostics])
		}
	}

	return result
}

export function getNewDiagnostics(oldDiagnostics: DiagnosticTuple[], newDiagnostics: DiagnosticTuple[]): DiagnosticTuple[] {
	const newProblems: DiagnosticTuple[] = []
	const oldMap = new Map(oldDiagnostics)

	for (const [uri, newDiags] of newDiagnostics) {
		const oldDiags = oldMap.get(uri) || []
		const newProblemsForUri = newDiags.filter((newDiag) => !oldDiags.some((oldDiag) => deepEqual(oldDiag, newDiag)))

		if (newProblemsForUri.length > 0) {
			newProblems.push([uri, newProblemsForUri])
		}
	}

	return newProblems
}

// Usage:
// const oldDiagnostics = // ... your old diagnostics array
// const newDiagnostics = // ... your new diagnostics array
// const newProblems = getNewDiagnostics(oldDiagnostics, newDiagnostics);

// Example usage with mocks:
//
// // Mock old diagnostics
// const oldDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [
//     [vscode.Uri.file("/path/to/file1.ts"), [
//         new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "Old error in file1", vscode.DiagnosticSeverity.Error)
//     ]],
//     [vscode.Uri.file("/path/to/file2.ts"), [
//         new vscode.Diagnostic(new vscode.Range(5, 5, 5, 15), "Old warning in file2", vscode.DiagnosticSeverity.Warning)
//     ]]
// ];
//
// // Mock new diagnostics
// const newDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = [
//     [vscode.Uri.file("/path/to/file1.ts"), [
//         new vscode.Diagnostic(new vscode.Range(0, 0, 0, 10), "Old error in file1", vscode.DiagnosticSeverity.Error),
//         new vscode.Diagnostic(new vscode.Range(2, 2, 2, 12), "New error in file1", vscode.DiagnosticSeverity.Error)
//     ]],
//     [vscode.Uri.file("/path/to/file2.ts"), [
//         new vscode.Diagnostic(new vscode.Range(5, 5, 5, 15), "Old warning in file2", vscode.DiagnosticSeverity.Warning)
//     ]],
//     [vscode.Uri.file("/path/to/file3.ts"), [
//         new vscode.Diagnostic(new vscode.Range(1, 1, 1, 11), "New error in file3", vscode.DiagnosticSeverity.Error)
//     ]]
// ];
//
// const newProblems = getNewProblems(oldDiagnostics, newDiagnostics);
//
// console.log("New problems:");
// for (const [uri, diagnostics] of newProblems) {
//     console.log(`File: ${uri.fsPath}`);
//     for (const diagnostic of diagnostics) {
//         console.log(`- ${diagnostic.message} (${diagnostic.range.start.line}:${diagnostic.range.start.character})`);
//     }
// }
//
// // Expected output:
// // New problems:
// // File: /path/to/file1.ts
// // - New error in file1 (2:2)
// // File: /path/to/file3.ts
// // - New error in file3 (1:1)

// will return empty string if no problems with the given severity are found
export async function diagnosticsToProblemsString(
	diagnostics: DiagnosticTuple[],
	severities: vscode.DiagnosticSeverity[],
): Promise<string> {
	const cwd = await getCwd()
	let result = ""
	for (const [uri, fileDiagnostics] of diagnostics) {
		const problems = fileDiagnostics.filter((d) => severities.includes(d.severity))
		if (problems.length > 0) {
			result += `\n\n${path.relative(cwd, uri.fsPath).toPosix()}`
			for (const diagnostic of problems) {
				let label: string
				switch (diagnostic.severity) {
					case vscode.DiagnosticSeverity.Error:
						label = "Error"
						break
					case vscode.DiagnosticSeverity.Warning:
						label = "Warning"
						break
					case vscode.DiagnosticSeverity.Information:
						label = "Information"
						break
					case vscode.DiagnosticSeverity.Hint:
						label = "Hint"
						break
					default:
						label = "Diagnostic"
				}
				const line = diagnostic.range.start.line + 1 // VSCode lines are 0-indexed
				const source = diagnostic.source ? `${diagnostic.source} ` : ""
				result += `\n- [${source}${label}] Line ${line}: ${diagnostic.message}`
			}
		}
	}
	return result.trim()
}
