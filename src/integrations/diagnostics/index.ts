import * as path from "path"
import deepEqual from "fast-deep-equal"
import { getCwd } from "@/utils/path"
import { Diagnostic, DiagnosticSeverity, FileDiagnostics } from "@/shared/proto/index.host"

export function getNewDiagnostics(oldDiagnostics: FileDiagnostics[], newDiagnostics: FileDiagnostics[]): FileDiagnostics[] {
	const oldMap = new Map<string, Diagnostic[]>()
	for (const diag of oldDiagnostics) {
		oldMap.set(diag.filePath, diag.diagnostics)
	}

	const newProblems: FileDiagnostics[] = []
	for (const newDiags of newDiagnostics) {
		const oldDiags = oldMap.get(newDiags.filePath) || []
		const newProblemsForFile = newDiags.diagnostics.filter(
			(newDiag) => !oldDiags.some((oldDiag) => deepEqual(oldDiag, newDiag)),
		)

		if (newProblemsForFile.length > 0) {
			newProblems.push({ filePath: newDiags.filePath, diagnostics: newProblemsForFile })
		}
	}

	return newProblems
}

// will return empty string if no problems with the given severity are found
export async function diagnosticsToProblemsString(
	diagnostics: FileDiagnostics[],
	severities: DiagnosticSeverity[],
): Promise<string> {
	const cwd = await getCwd()
	let result = ""
	for (const fileDiagnostics of diagnostics) {
		const problems = fileDiagnostics.diagnostics.filter((d) => severities.includes(d.severity))

		if (problems.length > 0) {
			const filePath = path.relative(cwd, fileDiagnostics.filePath).toPosix()
			result += `\n\n${filePath}`

			for (const diagnostic of problems) {
				const label = severityToString(diagnostic.severity)
				// Lines are 0-indexed
				const line = diagnostic.range?.start ? `${diagnostic.range.start.line + 1}` : ""

				const source = diagnostic.source ? `${diagnostic.source} ` : ""
				result += `\n- [${source}${label}] Line ${line}: ${diagnostic.message}`
			}
		}
	}
	return result.trim()
}

function severityToString(severity: DiagnosticSeverity): string {
	switch (severity) {
		case DiagnosticSeverity.DIAGNOSTIC_ERROR:
			return "Error"
		case DiagnosticSeverity.DIAGNOSTIC_WARNING:
			return "Warning"
		case DiagnosticSeverity.DIAGNOSTIC_INFORMATION:
			return "Information"
		case DiagnosticSeverity.DIAGNOSTIC_HINT:
			return "Hint"
		default:
			console.warn("Unhandled diagnostic severity level:", severity)
			return "Diagnostic"
	}
}
