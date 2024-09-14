import * as vscode from "vscode"
import deepEqual from "fast-deep-equal"

type FileDiagnostics = [vscode.Uri, vscode.Diagnostic[]][]

/*
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
- this works great for us since when claude edits/creates files its through vscode's textedit api's and we get those diagnostics for free
- some tools might require you to save the file or manually refresh to clear the problem from the list.
*/

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
		const currentDiagnostics = vscode.languages.getDiagnostics() // get all diagnostics for files open in workspace (not just errors/warnings so our did update check is more likely to detect updated diagnostics)

		if (!shouldWaitForChanges) {
			return currentDiagnostics
		}

		// it doesn't matter if we don't even have all the diagnostics yet, since claude will get the rest in the next request. as long as somethings changed, he can react to that in this request.
		if (!deepEqual(this.lastDiagnostics, currentDiagnostics)) {
			this.lastDiagnostics = currentDiagnostics
			return currentDiagnostics
		}

		return this.waitForUpdatedDiagnostics()
	}

	private async waitForUpdatedDiagnostics(timeout: number = 1_000): Promise<FileDiagnostics> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				cleanup()
				const finalDiagnostics = vscode.languages.getDiagnostics()
				this.lastDiagnostics = finalDiagnostics
				resolve(finalDiagnostics)
			}, timeout)

			const disposable = this.diagnosticsChangeEmitter.event(() => {
				cleanup()
				const updatedDiagnostics = vscode.languages.getDiagnostics()
				this.lastDiagnostics = updatedDiagnostics
				resolve(updatedDiagnostics)
			})

			const cleanup = () => {
				clearTimeout(timer)
				disposable.dispose()
			}
		})
	}

	public dispose() {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []
		this.diagnosticsChangeEmitter.dispose()
	}
}

export default DiagnosticsMonitor
