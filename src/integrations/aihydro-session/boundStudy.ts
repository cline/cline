import fs from "fs"
import os from "os"
import path from "path"
import type { BoundStudyInfo } from "@shared/ExtensionMessage"

// Mirrors the Python session layer (ai_hydro.session.chat_binding /
// ai_hydro.session.store): the binding map and per-study files live under
// ~/.aihydro. We only ever READ these files here — the MCP server owns writes.
const AIHYDRO_HOME = path.join(os.homedir(), ".aihydro")
const CHAT_STUDIES_FILE = path.join(AIHYDRO_HOME, "chat_studies.json")
const SESSIONS_DIR = path.join(AIHYDRO_HOME, "sessions")

interface ChatStudiesFile {
	chat_to_study?: Record<string, string>
}

/**
 * Resolve which ai-hydro study a chat is bound to, for the task-header chip.
 *
 * The chat is identified by its task ulid — the same value the extension injects
 * as `_chat_id` on every ai-hydro MCP call (see isAiHydroServerName), which the
 * Python resolver writes into ~/.aihydro/chat_studies.json. Reads are fully
 * defensive: a missing/partial/unreadable file simply yields `undefined`, so the
 * chip is absent rather than ever breaking the header.
 *
 * @param ulid the bound Task's `ulid` (NOT `taskId` — they differ)
 * @param aihydroHome override for the ~/.aihydro root (testing only)
 */
export function getBoundStudy(ulid: string | undefined, aihydroHome: string = AIHYDRO_HOME): BoundStudyInfo | undefined {
	if (!ulid) {
		return undefined
	}
	const chatStudiesFile = aihydroHome === AIHYDRO_HOME ? CHAT_STUDIES_FILE : path.join(aihydroHome, "chat_studies.json")
	const sessionsDir = aihydroHome === AIHYDRO_HOME ? SESSIONS_DIR : path.join(aihydroHome, "sessions")

	let studyId: string | undefined
	try {
		const raw = fs.readFileSync(chatStudiesFile, "utf-8")
		const parsed = JSON.parse(raw) as ChatStudiesFile
		studyId = parsed.chat_to_study?.[ulid]
	} catch {
		return undefined
	}
	if (!studyId) {
		return undefined
	}

	// Best-effort enrichment with the human-readable site name; the study id
	// alone is still a valid chip if the session file is absent or unreadable.
	let siteName: string | undefined
	try {
		const sessionPath = path.join(sessionsDir, `${studyId}.json`)
		const sessionRaw = fs.readFileSync(sessionPath, "utf-8")
		const session = JSON.parse(sessionRaw) as { site_name?: string }
		if (typeof session.site_name === "string" && session.site_name.trim()) {
			siteName = session.site_name.trim()
		}
	} catch {
		// no enrichment available — studyId-only chip is fine
	}

	return { studyId, ...(siteName ? { siteName } : {}) }
}
