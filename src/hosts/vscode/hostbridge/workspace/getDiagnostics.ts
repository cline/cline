import { GetDiagnosticsRequest, GetDiagnosticsResponse } from "@/shared/proto/host/workspace"
import { Diagnostic, DiagnosticPosition, DiagnosticRange, DiagnosticSeverity, FileDiagnostics } from "@/shared/proto/index.cline"
import * as vscode from "vscode"
import "@/utils/path" // for String.prototype.toPosix

export async function getDiagnostics(_request: GetDiagnosticsRequest): Promise<GetDiagnosticsResponse> {
	// Get all diagnostics from VS Code
	const vscodeAllDiagnostics = vscode.languages.getDiagnostics()

	const fileDiagnostics = convertToFileDiagnostics(vscodeAllDiagnostics)

	return { fileDiagnostics }
}

export function convertToFileDiagnostics(vscodeAllDiagnostics: [vscode.Uri, vscode.Diagnostic[]][]): FileDiagnostics[] {
	const result = []
	for (const [uri, diagnostics] of vscodeAllDiagnostics) {
		if (diagnostics.length > 0) {
			result.push(
				FileDiagnostics.create({
					filePath: uri.fsPath.toPosix(),
					diagnostics: convertVscodeDiagnostics(diagnostics),
				}),
			)
		}
	}
	return result
}

export function convertVscodeDiagnostics(vscodeDiagnostics: vscode.Diagnostic[]): Diagnostic[] {
	return vscodeDiagnostics.map(convertVscodeDiagnostic)
}

function convertVscodeDiagnostic(vscodeDiagnostic: vscode.Diagnostic): Diagnostic {
	return {
		message: vscodeDiagnostic.message,
		range: {
			start: {
				line: vscodeDiagnostic.range.start.line,
				character: vscodeDiagnostic.range.start.character,
			},
			end: {
				line: vscodeDiagnostic.range.end.line,
				character: vscodeDiagnostic.range.end.character,
			},
		},
		severity: convertSeverity(vscodeDiagnostic.severity),
		source: vscodeDiagnostic.source,
	}
}

// Convert VS Code severity to proto severity
function convertSeverity(vscodeSeverity: vscode.DiagnosticSeverity): DiagnosticSeverity {
	switch (vscodeSeverity) {
		case vscode.DiagnosticSeverity.Error:
			return DiagnosticSeverity.DIAGNOSTIC_ERROR
		case vscode.DiagnosticSeverity.Warning:
			return DiagnosticSeverity.DIAGNOSTIC_WARNING
		case vscode.DiagnosticSeverity.Information:
			return DiagnosticSeverity.DIAGNOSTIC_INFORMATION
		case vscode.DiagnosticSeverity.Hint:
			return DiagnosticSeverity.DIAGNOSTIC_HINT
		default:
			console.warn("Unhandled vscode severity", vscodeSeverity)
			return DiagnosticSeverity.DIAGNOSTIC_ERROR
	}
}
