// Checkpoints have been removed. Stub for compilation compatibility.
import crypto from "crypto"

export function hashWorkingDir(dir: string): string {
	return crypto.createHash("sha256").update(dir).digest("hex").slice(0, 16)
}
