import type { DiffViewProvider } from "@/integrations/editor/DiffViewProvider"

export interface FileOpsResult {
	finalContent?: string
	deleted?: boolean
	newProblemsMessage?: string
	userEdits?: string
	autoFormattingEdits?: string
}

/**
 * Utility class for file operations via a DiffViewProvider
 */
export class FileProviderOperations {
	constructor(private provider: DiffViewProvider) {}

	async openFile(path: string): Promise<void> {
		await this.provider.open(path)
	}

	/**
	 * Saves the current changes and returns the result.
	 */
	async saveChanges(): Promise<FileOpsResult> {
		const result = await this.provider.saveChanges()
		return result
	}

	/**
	 * Creates a file. If isFinal is false, prepares the creation without saving.
	 * Call saveChanges() after approval when isFinal is false.
	 */
	async createFile(path: string, content: string, isFinal: boolean = true): Promise<FileOpsResult | undefined> {
		this.provider.editType = "create"
		await this.openFile(path)
		// Always pass isFinal=true to update() to ensure proper document finalization
		// (extends replacement range to full document, truncates trailing content).
		// The isFinal parameter here only controls whether to save after the update.
		await this.provider.update(content, true)

		if (isFinal) {
			return await this.saveChanges()
		}
		return undefined
	}

	/**
	 * Modifies a file. If isFinal is false, prepares the modification without saving.
	 * Call saveChanges() after approval when isFinal is false.
	 */
	async modifyFile(path: string, content: string, isFinal: boolean = true): Promise<FileOpsResult | undefined> {
		this.provider.editType = "modify"
		await this.openFile(path)
		// Always pass isFinal=true to update() to ensure proper document finalization
		// (extends replacement range to full document, truncates trailing content).
		// The isFinal parameter here only controls whether to save after the update.
		await this.provider.update(content, true)

		if (isFinal) {
			return await this.saveChanges()
		}
		return undefined
	}

	/**
	 * Deletes a file. If isFinal is false, prepares the deletion without actually deleting.
	 * Opens the file in the diff view to show it will be deleted.
	 * Call deleteFile() with isFinal=true after approval when isFinal is false.
	 */
	async deleteFile(path: string, isFinal: boolean = true): Promise<FileOpsResult | undefined> {
		this.provider.editType = "delete"
		await this.openFile(path)

		if (isFinal) {
			await this.provider.deleteFile(path)
			return undefined
		} else {
			// Update with empty content to show the file will be deleted
			// Always pass isFinal=true to update() to ensure proper document finalization
			await this.provider.update("", true)
			return undefined
		}
	}

	/**
	 * Moves a file from oldPath to newPath. If isFinal is false, prepares the move without saving.
	 * Call saveChanges() after approval when isFinal is false.
	 */
	async moveFile(
		oldPath: string,
		newPath: string,
		content: string,
		isFinal: boolean = true,
	): Promise<FileOpsResult | undefined> {
		if (isFinal) {
			const result = await this.createFile(newPath, content, isFinal)
			await this.deleteFile(oldPath, isFinal)
			return result
		} else {
			await this.createFile(newPath, content, isFinal)
			await this.deleteFile(oldPath, isFinal)
			return undefined
		}
	}

	async getFileContent(): Promise<string | undefined> {
		return this.provider.originalContent
	}
}
