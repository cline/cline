import { HostProvider } from "@/hosts/host-provider"
import { EditPreview, type EditPreviewContent } from "@/integrations/editor/EditPreview"
import { Logger } from "@/shared/services/Logger"

/**
 * External-host (JetBrains/standalone) implementation of the read-only edit preview,
 * rendered over the existing DiffService host-bridge RPCs. openMultiFileDiff shows a
 * left/right content diff without touching the file; closeAllDiffs is the host's
 * coarse close (external hosts don't expose per-tab close over the bridge).
 */
export class ExternalEditPreview extends EditPreview {
	private isOpen = false

	override async open(content: EditPreviewContent): Promise<void> {
		await HostProvider.diff.openMultiFileDiff({
			title: content.title,
			diffs: [
				{
					filePath: content.absolutePath,
					leftContent: content.leftContent,
					rightContent: content.rightContent,
				},
			],
		})
		this.isOpen = true
	}

	override async close(): Promise<void> {
		if (!this.isOpen) {
			return
		}
		this.isOpen = false
		try {
			await HostProvider.diff.closeAllDiffs({})
		} catch (error) {
			Logger.warn(`[ExternalEditPreview] Failed to close diff views: ${error}`)
		}
	}
}
