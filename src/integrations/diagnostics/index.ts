import * as vscode from "vscode"
import * as path from "path"
import deepEqual from "fast-deep-equal"

export function getNewDiagnostics(
	oldDiagnostics: [vscode.Uri, vscode.Diagnostic[]][],
	newDiagnostics: [vscode.Uri, vscode.Diagnostic[]][]
): [vscode.Uri, vscode.Diagnostic[]][] {
	const newProblems: [vscode.Uri, vscode.Diagnostic[]][] = []
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
export function diagnosticsToProblemsString(
	diagnostics: [vscode.Uri, vscode.Diagnostic[]][],
	severities: vscode.DiagnosticSeverity[],
	cwd: string
): string {
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
