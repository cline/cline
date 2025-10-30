import type { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

/**
 * Utility class for file operations via a DiffViewProvider
 */
export class FileProviderOperations {
	constructor(private provider: DiffViewProvider) {}

	async createFile(path: string, content: string): Promise<{ finalContent?: string }> {
		this.provider.editType = "create"
		await this.provider.open(path)
		await this.provider.update(content, true)
		const result = await this.provider.saveChanges()
		await this.provider.reset()
		return result
	}

	async modifyFile(path: string, content: string): Promise<{ finalContent?: string }> {
		this.provider.editType = "modify"
		await this.provider.open(path)
		await this.provider.update(content, true)
		const result = await this.provider.saveChanges()
		await this.provider.reset()
		return result
	}

	async deleteFile(path: string): Promise<void> {
		this.provider.editType = "modify"
		await this.provider.open(path)
		await this.provider.revertChanges()
	}

	async moveFile(oldPath: string, newPath: string, content: string): Promise<{ finalContent?: string }> {
		const result = await this.createFile(newPath, content)
		await this.deleteFile(oldPath)
		return result
	}

	async getlFileContent(): Promise<string | undefined> {
		return this.provider.originalContent
	}
}
