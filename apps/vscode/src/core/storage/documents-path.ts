import { execa } from "@packages/execa"
import os from "os"
import * as path from "path"
import { Logger } from "@/shared/services/Logger"

// The Unicode replacement character. Windows PowerShell 5.1 writes redirected
// stdout using the console/OEM code page, not UTF-8. If that code page can't
// represent a character (e.g. Japanese in a non-Unicode locale), decoding the
// bytes as UTF-8 below turns them into this character instead of throwing, so
// its presence means the path we got back is corrupted, not just unusual.
const REPLACEMENT_CHARACTER = "�"

export async function getDocumentsPath(): Promise<string> {
	if (process.platform === "win32") {
		try {
			const { stdout: docsPath } = await execa("powershell", [
				"-NoProfile", // Ignore user's PowerShell profile(s)
				"-Command",
				// Force the console to emit UTF-8 before reading the folder path, so
				// a non-ASCII Documents path (e.g. redirected by OneDrive to a
				// Japanese folder name) round-trips correctly instead of being
				// mangled by the default OEM code page.
				"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)",
			])
			const trimmedPath = docsPath.trim()
			if (trimmedPath && !trimmedPath.includes(REPLACEMENT_CHARACTER)) {
				return trimmedPath
			}
			if (trimmedPath) {
				// A corrupted path must never be used: Cline would create (and keep
				// recreating) a mojibake folder, which can even sync to the cloud
				// when Documents is redirected by OneDrive.
				Logger.error(
					`Windows Documents path decoded with replacement characters, falling back to homedir/Documents: ${trimmedPath}`,
				)
			}
		} catch (_err) {
			Logger.error("Failed to retrieve Windows Documents path. Falling back to homedir/Documents.")
		}
	} else if (process.platform === "linux") {
		try {
			// First check if xdg-user-dir exists
			await execa("which", ["xdg-user-dir"])

			// If it exists, try to get XDG documents path
			const { stdout } = await execa("xdg-user-dir", ["DOCUMENTS"])
			const trimmedPath = stdout.trim()
			if (trimmedPath) {
				return trimmedPath
			}
		} catch {
			// Log error but continue to fallback
			Logger.error("Failed to retrieve XDG Documents path. Falling back to homedir/Documents.")
		}
	}

	// Default fallback for all platforms
	return path.join(os.homedir(), "Documents")
}
