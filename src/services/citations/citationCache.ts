/**
 * Citation cache — read/write ~/.aihydro/citations/<doi-encoded>.json
 *
 * Each cached entry stores the CSL-JSON record plus metadata so callers can
 * tell how fresh it is and which provider resolved it.
 *
 * TTL: 30 days.  The caller can force a refresh by passing `forceRefresh: true`
 * to `lookupCitation`.  Manual invalidation: delete the file.
 */

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const CACHE_DIR = path.join(os.homedir(), ".aihydro", "citations")
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export interface CachedCitation {
	doi: string
	cslJson: Record<string, unknown>
	formattedApa: string
	source: "crossref" | "semantic-scholar" | "datacite" | "seed"
	confidence: "high" | "medium" | "low"
	cachedAtMs: number
}

/**
 * Encode a DOI into a safe filename (replace / with __).
 */
function doiToFilename(doi: string): string {
	return doi
		.toLowerCase()
		.replace(/https?:\/\/doi\.org\//i, "")
		.replace(/\//g, "__")
		.replace(/[^a-z0-9._-]/g, "_")
}

export async function getCached(doi: string): Promise<CachedCitation | null> {
	try {
		await fs.mkdir(CACHE_DIR, { recursive: true })
		const file = path.join(CACHE_DIR, `${doiToFilename(doi)}.json`)
		const raw = await fs.readFile(file, "utf8")
		const entry = JSON.parse(raw) as CachedCitation
		if (Date.now() - entry.cachedAtMs > TTL_MS) {
			return null // stale
		}
		return entry
	} catch {
		return null
	}
}

export async function putCached(entry: CachedCitation): Promise<void> {
	try {
		await fs.mkdir(CACHE_DIR, { recursive: true })
		const file = path.join(CACHE_DIR, `${doiToFilename(entry.doi)}.json`)
		await fs.writeFile(file, JSON.stringify(entry, null, 2), "utf8")
	} catch (err) {
		console.warn("[citationCache] Failed to write cache:", err)
	}
}

/**
 * Seed the cache from a bundled JSON object (called once at extension activation
 * if the cache entry is missing).  The seed is shipped with the extension so
 * the 200 canonical hydrology DOIs are available offline from day one.
 */
export async function seedCache(seedData: Record<string, CachedCitation>): Promise<void> {
	for (const [, entry] of Object.entries(seedData)) {
		const cached = await getCached(entry.doi)
		if (!cached) {
			await putCached(entry)
		}
	}
}
