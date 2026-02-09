import type { ToolParamName, ToolUse } from "@core/assistant-message"
import type { BeadsmithIgnoreController } from "@core/ignore/BeadsmithIgnoreController"

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Lightweight validator used by new tool handlers.
 * The legacy ToolExecutor switch remains unchanged and does not depend on this.
 */
export class ToolValidator {
	constructor(private readonly beadsmithIgnoreController: BeadsmithIgnoreController) {}

	/**
	 * Verifies required parameters exist on the tool block.
	 * Returns a message suitable for displaying in an error.
	 */
	assertRequiredParams(block: ToolUse, ...params: ToolParamName[]): ValidationResult {
		for (const p of params) {
			// params are stored under block.params using their tag name
			const val = (block as any)?.params?.[p]
			if (val === undefined || val === null || String(val).trim() === "") {
				return { ok: false, error: `Missing required parameter '${p}' for tool '${block.name}'.` }
			}
		}
		return { ok: true }
	}

	/**
	 * Verifies access is allowed to a given path via .beadsmithignore rules.
	 * Callers should pass a repo-relative (workspace-relative) path.
	 */
	checkBeadsmithIgnorePath(relPath: string): ValidationResult {
		const accessAllowed = this.beadsmithIgnoreController.validateAccess(relPath)
		if (!accessAllowed) {
			return {
				ok: false,
				error: `Access to path '${relPath}' is blocked by .beadsmithignore settings.`,
			}
		}
		return { ok: true }
	}
}
