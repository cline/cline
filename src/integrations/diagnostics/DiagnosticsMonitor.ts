/*
import * as vscode from "vscode"
import deepEqual from "fast-deep-equal"

type FileDiagnostics = [vscode.Uri, vscode.Diagnostic[]][]


About Diagnostics:
The Problems tab shows diagnostics that have been reported for your project. These diagnostics are categorized into:
Errors: Critical issues that usually prevent your code from compiling or running correctly.
Warnings: Potential problems in the code that may not prevent it from running but could cause issues (e.g., bad practices, unused variables).
Information: Non-critical suggestions or tips (e.g., formatting issues or notes from linters).
The Problems tab displays diagnostics from various sources:
1. Language Servers:
   - TypeScript: Type errors, missing imports, syntax issues
   - Python: Syntax errors, invalid type hints, undefined variables
   - JavaScript/Node.js: Parsing and execution errors
2. Linters:
   - ESLint: Code style, best practices, potential bugs
   - Pylint: Unused imports, naming conventions
   - TSLint: Style and correctness issues in TypeScript
3. Build Tools:
   - Webpack: Module resolution failures, build errors
   - Gulp: Build errors during task execution
4. Custom Validators:
   - Extensions can generate custom diagnostics for specific languages or tools
Each problem typically indicates its source (e.g., language server, linter, build tool).
Diagnostics update in real-time as you edit code, helping identify issues quickly. For example, if you introduce a syntax error in a TypeScript file, the Problems tab will immediately display the new error.

Notes on diagnostics:
- linter diagnostics are only captured for open editors
- this works great for us since when cline edits/creates files its through vscode's textedit api's and we get those diagnostics for free
- some tools might require you to save the file or manually refresh to clear the problem from the list.

System Prompt
- You will automatically receive workspace error diagnostics in environment_details. Be mindful that this may include issues beyond the scope of your task or the user's request. Only address errors relevant to your work, and avoid fixing pre-existing or unrelated issues unless the user specifically instructs you to do so.
- If you are unable to resolve errors provided in environment_details after two attempts, consider using ask_followup_question to ask the user for additional information, such as the latest documentation related to a problematic framework, to help you make progress on the task. If the error remains unresolved after this step, proceed with your task while disregarding the error.

class DiagnosticsMonitor {
	private diagnosticsChangeEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
	private disposables: vscode.Disposable[] = []
	private lastDiagnostics: FileDiagnostics = []

	constructor() {
		this.disposables.push(
			vscode.languages.onDidChangeDiagnostics(() => {
				this.diagnosticsChangeEmitter.fire()
			})
		)
	}

	public async getCurrentDiagnostics(shouldWaitForChanges: boolean): Promise<FileDiagnostics> {
		const currentDiagnostics = this.getDiagnostics()
		if (!shouldWaitForChanges) {
			this.lastDiagnostics = currentDiagnostics
			return currentDiagnostics
		}

		if (!deepEqual(this.lastDiagnostics, currentDiagnostics)) {
			this.lastDiagnostics = currentDiagnostics
			return currentDiagnostics
		}

		let timeout = 300 // only way this happens is if there's no errors

		// if diagnostics contain existing errors (since the check above didn't trigger) then it's likely cline just did something that should have fixed the error, so we'll give a longer grace period for diagnostics to catch up
		const hasErrors = currentDiagnostics.some(([_, diagnostics]) =>
			diagnostics.some((d) => d.severity === vscode.DiagnosticSeverity.Error)
		)
		if (hasErrors) {
			console.log("Existing errors detected, extending timeout", currentDiagnostics)
			timeout = 10_000
		}

		return this.waitForUpdatedDiagnostics(timeout)
	}

	private async waitForUpdatedDiagnostics(timeout: number): Promise<FileDiagnostics> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				cleanup()
				const finalDiagnostics = this.getDiagnostics()
				this.lastDiagnostics = finalDiagnostics
				resolve(finalDiagnostics)
			}, timeout)

			const disposable = this.diagnosticsChangeEmitter.event(() => {
				const updatedDiagnostics = this.getDiagnostics() // I thought this would only trigger when diagnostics changed, but that's not the case.
				if (deepEqual(this.lastDiagnostics, updatedDiagnostics)) {
					// diagnostics have not changed, ignoring...
					return
				}
				cleanup()
				this.lastDiagnostics = updatedDiagnostics
				resolve(updatedDiagnostics)
			})

			const cleanup = () => {
				clearTimeout(timer)
				disposable.dispose()
			}
		})
	}

	private getDiagnostics(): FileDiagnostics {
		const allDiagnostics = vscode.languages.getDiagnostics()
		return allDiagnostics
			.filter(([_, diagnostics]) => diagnostics.some((d) => d.severity === vscode.DiagnosticSeverity.Error))
			.map(([uri, diagnostics]) => [
				uri,
				diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error),
			])
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.diagnosticsChangeEmitter.dispose()
	}
}

export default DiagnosticsMonitor
*/
