import type { ToolParamName, ToolUse } from "@core/assistant-message"
import type { ClineIgnoreController } from "@core/ignore/ClineIgnoreController"

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Lightweight validator used by new tool handlers.
 * The legacy ToolExecutor switch remains unchanged and does not depend on this.
 */
export class ToolValidator {
	constructor(private readonly clineIgnoreController: ClineIgnoreController) {}

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
	 * Verifies access is allowed to a given path via .clineignore rules.
	 * Callers should pass a repo-relative (workspace-relative) path.
	 */
	checkClineIgnorePath(relPath: string): ValidationResult {
		const accessAllowed = this.clineIgnoreController.validateAccess(relPath)
		if (!accessAllowed) {
			return {
				ok: false,
				error: `Access to path '${relPath}' is blocked by .clineignore settings.`,
			}
		}
		return { ok: true }
	}
}
