import { HostProvider } from "@/hosts/host-provider"
import { GetDiagnosticsRequest, DiagnosticSeverity } from "@/shared/proto/host/workspace"
import { Metadata } from "@/shared/proto/cline/common"

/**
 * Host-agnostic function to get workspace problems as a formatted string
 * Used by @problems mention for cross-host compatibility
 */
export async function getWorkspaceProblemsString(): Promise<string> {
	const response = await HostProvider.workspace.getDiagnostics(
		GetDiagnosticsRequest.create({
			metadata: Metadata.create({}),
		}),
	)

	if (response.fileDiagnostics.length === 0) {
		return "No errors or warnings detected."
	}

	let result = ""
	for (const fileDiagnostics of response.fileDiagnostics) {
		const problems = fileDiagnostics.diagnostics.filter(
			(d) => d.severity === DiagnosticSeverity.DIAGNOSTIC_ERROR || d.severity === DiagnosticSeverity.DIAGNOSTIC_WARNING,
		)

		if (problems.length > 0) {
			result += `\n\n${fileDiagnostics.filePath}`
			for (const diagnostic of problems) {
				let label: string
				switch (diagnostic.severity) {
					case DiagnosticSeverity.DIAGNOSTIC_ERROR:
						label = "Error"
						break
					case DiagnosticSeverity.DIAGNOSTIC_WARNING:
						label = "Warning"
						break
					case DiagnosticSeverity.DIAGNOSTIC_INFORMATION:
						label = "Information"
						break
					case DiagnosticSeverity.DIAGNOSTIC_HINT:
						label = "Hint"
						break
					default:
						label = "Diagnostic"
				}
				const line = (diagnostic.range?.start?.line || 0) + 1 // Proto lines are 0-indexed
				const source = diagnostic.source ? `${diagnostic.source} ` : ""
				result += `\n- [${source}${label}] Line ${line}: ${diagnostic.message}`
			}
		}
	}
	return result.trim()
}
