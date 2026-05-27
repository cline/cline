import { resolveWorkspacePath } from "@/core/workspace"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * Utility class for resolving and validating file paths within a task context
 */
export class PathResolver {
	constructor(
		private config: TaskConfig,
		private validator: ToolValidator,
	) {}

	resolve(filePath: string, caller: string): { absolutePath: string; resolvedPath: string } | undefined {
		try {
			const pathResult = resolveWorkspacePath(this.config, filePath, caller)
			return typeof pathResult === "string"
				? { absolutePath: pathResult, resolvedPath: filePath }
				: { absolutePath: pathResult.absolutePath, resolvedPath: pathResult.resolvedPath }
		} catch {
			return undefined
		}
	}

	validate(resolvedPath: string): { ok: boolean; error?: string } {
		return this.validator.checkClineIgnorePath(resolvedPath)
	}

	async resolveAndValidate(
		filePath: string,
		caller: string,
	): Promise<{ absolutePath: string; resolvedPath: string } | undefined> {
		const resolution = this.resolve(filePath, caller)
		if (!resolution) {
			return undefined
		}

		const validation = this.validate(resolution.resolvedPath)
		if (!validation.ok) {
			return undefined
		}

		return resolution
	}
}
