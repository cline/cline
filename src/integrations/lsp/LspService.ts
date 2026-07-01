import * as vscode from "vscode"

interface LocationResult {
	file: string
	line: number
	column: number
	snippet?: string
}

export class LspService {
	private cache = new Map<string, any>()

	constructor(private sessionId: string = "") {}

	private getCacheKey(baseKey: string): string {
		return this.sessionId ? `${this.sessionId}:${baseKey}` : baseKey
	}

	async findDefinition(uri: vscode.Uri, position: vscode.Position): Promise<LocationResult[]> {
		const key = this.getCacheKey(`definition:${uri.toString()}:${position.line}:${position.character}`)
		if (this.cache.has(key)) {
			return this.cache.get(key)
		}
		try {
			const result = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, position)
			const locations = Array.isArray(result) ? result : result ? [result] : []
			const processed = await this.processLocations(locations)
			this.cache.set(key, processed)
			return processed
		} catch (error) {
			return []
		}
	}

	async findReferences(uri: vscode.Uri, position: vscode.Position): Promise<LocationResult[]> {
		const key = this.getCacheKey(`references:${uri.toString()}:${position.line}:${position.character}`)
		if (this.cache.has(key)) {
			return this.cache.get(key)
		}
		try {
			const locations = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeReferenceProvider", uri, position)
			const processed = await this.processLocations(locations || [])
			this.cache.set(key, processed)
			return processed
		} catch (error) {
			return []
		}
	}

	async getDocumentSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
		const key = this.getCacheKey(`documentSymbols:${uri.toString()}`)
		if (this.cache.has(key)) {
			return this.cache.get(key)
		}
		try {
			const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", uri)
			const result = symbols || []
			this.cache.set(key, result)
			return result
		} catch (error) {
			return []
		}
	}

	async getWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
		const key = this.getCacheKey(`workspaceSymbols:${query}`)
		if (this.cache.has(key)) {
			return this.cache.get(key)
		}
		try {
			const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", query)
			const result = symbols || []
			this.cache.set(key, result)
			return result
		} catch (error) {
			return []
		}
	}

	async getHover(uri: vscode.Uri, position: vscode.Position): Promise<any> {
		const key = this.getCacheKey(`hover:${uri.toString()}:${position.line}:${position.character}`)
		if (this.cache.has(key)) {
			return this.cache.get(key)
		}
		try {
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", uri, position)
			const result = hovers && hovers.length > 0 ? hovers[0] : undefined
			this.cache.set(key, result)
			return result
		} catch (error) {
			return undefined
		}
	}

	private async processLocations(locations: any[]): Promise<LocationResult[]> {
		const results: LocationResult[] = []
		for (const location of locations) {
			const uri = location.uri || location.targetUri
			const range = location.range || location.targetRange || location.targetSelectionRange
			if (!uri || !range) continue
			const snippet = await this.getSnippet(uri, range.start.line)
			results.push({
				file: uri.fsPath,
				line: range.start.line,
				column: range.start.character,
				snippet
			})
		}
		return results
	}

	private async getSnippet(uri: vscode.Uri, line: number): Promise<string | undefined> {
		try {
			const document = await vscode.workspace.openTextDocument(uri)
			if (line >= 0 && line < document.lineCount) {
				return document.lineAt(line).text
			}
		} catch (error) {}
		return undefined
	}

	clearCache(): void {
		this.cache.clear()
	}
}
