import type { GetLedgerStateRequest, LedgerStateResponse } from "@shared/proto/cline/ledger"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { loadClaimSurface, resolveSessionJsonPath } from "@/integrations/aihydro-session/sessionSurfaces"
import type { Controller } from ".."

const SESSIONS_DIR = path.join(os.homedir(), ".aihydro", "sessions")

async function mostRecentSessionId(): Promise<string> {
	const entries = await fs.readdir(SESSIONS_DIR).catch(() => [] as string[])
	const jsonFiles = entries.filter((entry) => entry.endsWith(".json"))
	if (jsonFiles.length === 0) {
		return ""
	}
	const withMtime = await Promise.all(
		jsonFiles.map(async (file) => {
			const stat = await fs.stat(path.join(SESSIONS_DIR, file)).catch(() => null)
			return { file, mtime: stat?.mtimeMs ?? 0 }
		}),
	)
	withMtime.sort((a, b) => b.mtime - a.mtime)
	return withMtime[0].file.replace(/\.json$/, "")
}

/**
 * Load claims for a session from persisted AI-Hydro session/capsule state.
 * If session_id is empty, reads the most recently modified session file.
 */
export async function getLedgerState(_controller: Controller, request: GetLedgerStateRequest): Promise<LedgerStateResponse> {
	let sessionIdOrPath = request.sessionId?.trim() || ""
	try {
		if (!sessionIdOrPath) {
			sessionIdOrPath = await mostRecentSessionId()
			if (!sessionIdOrPath) {
				return { sessionId: "", claims: [], updatedAtMs: 0 }
			}
		}

		const surface = loadClaimSurface(sessionIdOrPath)
		const sessionPath = resolveSessionJsonPath(sessionIdOrPath)
		const stat = sessionPath ? await fs.stat(sessionPath).catch(() => null) : null
		return {
			sessionId: surface.session_id,
			claims: surface.claims,
			updatedAtMs: stat?.mtimeMs ?? 0,
		}
	} catch (error) {
		console.error("[getLedgerState] Error:", error)
		return { sessionId: request.sessionId ?? "", claims: [], updatedAtMs: 0 }
	}
}
