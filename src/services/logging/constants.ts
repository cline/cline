import * as os from "os"
import * as path from "path"

/**
 * Gets the VS Code logs directory path (~/.cline/logs/vscode)
 * This is the centralized location for all VS Code extension logs.
 */
export function getVSCodeLogsDir(): string {
	return path.join(os.homedir(), ".cline", "logs", "vscode")
}
