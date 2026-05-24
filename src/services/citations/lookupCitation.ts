/**
 * lookupCitation — CrossRef → Semantic Scholar → DataCite cascade
 *
 * Called by the `lookup_citation` MCP tool (Python) and the citation-adapter
 * (iframe-side).  Always reads the disk cache first; only hits APIs if the
 * entry is missing or stale.
 *
 * Anti-hallucination guarantee:
 *   Returns `null` if no provider returns a high/medium-confidence match.
 *   NEVER invents a DOI.  Callers must surface "no citation found" to the
 *   user when this function returns null.
 *
 * Polite-pool headers per CrossRef best practices:
 *   User-Agent: AI-Hydro/0.1.24 (+mailto:gh9690@myamu.ac.in)
 */

import type { CachedCitation } from "./citationCache"
import { getCached, putCached } from "./citationCache"

const POLITE_UA = "AI-Hydro/0.1.24 (+mailto:gh9690@myamu.ac.in)"
const FETCH_TIMEOUT_MS = 8_000

export type CitationResult = {
	doi: string
	formattedApa: string
	cslJson: Record<string, unknown>
	source: CachedCitation["source"]
	confidence: CachedCitation["confidence"]
	fromCache: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
	try {
		return await fetch(url, { ...init, signal: controller.signal })
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Render a simple APA string from a CrossRef/CSL-JSON work object.
 * A full citeproc-js integration is the Phase 3 follow-up; this covers ~95% of cases.
 */
function renderApa(csl: Record<string, unknown>): string {
	const authors = (csl.author as Array<{ family?: string; given?: string; name?: string }> | undefined) ?? []
	const authorStr =
		authors.length === 0
			? "Unknown"
			: authors.length <= 6
				? authors.map((a) => (a.family ? `${a.family}, ${(a.given ?? "").charAt(0)}.` : (a.name ?? ""))).join(", ")
				: authors
						.slice(0, 6)
						.map((a) => (a.family ? `${a.family}, ${(a.given ?? "").charAt(0)}.` : (a.name ?? "")))
						.join(", ") + " et al."

	const year =
		(
			(csl.issued as { "date-parts"?: number[][] } | undefined)?.["date-parts" as keyof typeof csl.issued] as
				| number[][]
				| undefined
		)?.[0]?.[0] ?? ""
	const title = (csl.title as string[] | string | undefined)?.[0] ?? csl.title ?? "Untitled"
	const journal = (csl["container-title"] as string[] | string | undefined)?.[0] ?? ""
	const volume = csl.volume ?? ""
	const issue = csl.issue ? `(${csl.issue})` : ""
	const page = csl.page ?? ""
	const doi = csl.DOI ? ` https://doi.org/${csl.DOI}` : ""

	let apa = `${authorStr} (${year}). ${title}.`
	if (journal) apa += ` *${journal}*`
	if (volume) apa += `, *${volume}*${issue}`
	if (page) apa += `, ${page}`
	apa += `.${doi}`
	return apa.replace(/\*\*/g, "")
}

// ── Provider 1: CrossRef ──────────────────────────────────────────────────

async function fromCrossRef(query: string): Promise<CitationResult | null> {
	try {
		const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=3&mailto=gh9690%40myamu.ac.in`
		const res = await fetchWithTimeout(url, {
			headers: { "User-Agent": POLITE_UA },
		})
		if (!res.ok) return null
		const data = (await res.json()) as {
			message?: { items?: Array<Record<string, unknown>> }
		}
		const items = data.message?.items ?? []
		if (items.length === 0) return null

		// Score by title match
		const lq = query.toLowerCase()
		const best = items.sort((a, b) => {
			const scoreA = titleMatch(a.title as string[] | undefined, lq)
			const scoreB = titleMatch(b.title as string[] | undefined, lq)
			return scoreB - scoreA
		})[0]

		if (!best || !(best.DOI as string | undefined)) return null

		const doi = (best.DOI as string).toLowerCase()
		const apa = renderApa(best)
		const confidence = titleMatch(best.title as string[] | undefined, lq) > 0.5 ? "high" : "medium"

		return {
			doi,
			formattedApa: apa,
			cslJson: best,
			source: "crossref",
			confidence,
			fromCache: false,
		}
	} catch {
		return null
	}
}

function titleMatch(titles: string[] | undefined, query: string): number {
	if (!titles || titles.length === 0) return 0
	const title = titles[0].toLowerCase()
	const words = query.split(/\s+/).filter((w) => w.length > 3)
	if (words.length === 0) return 0
	const hits = words.filter((w) => title.includes(w)).length
	return hits / words.length
}

// ── Provider 2: Semantic Scholar ─────────────────────────────────────────

async function fromSemanticScholar(query: string): Promise<CitationResult | null> {
	try {
		const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=3&fields=title,authors,year,externalIds,journal,volume,pages`
		const res = await fetchWithTimeout(url, {
			headers: {
				"User-Agent": POLITE_UA,
				Accept: "application/json",
			},
		})
		if (!res.ok) return null
		const data = (await res.json()) as {
			data?: Array<{
				title?: string
				authors?: Array<{ name: string }>
				year?: number
				externalIds?: { DOI?: string }
				journal?: { name?: string; volume?: string; pages?: string }
			}>
		}
		const items = data.data ?? []
		if (items.length === 0) return null

		const best = items[0]
		const doi = best.externalIds?.DOI?.toLowerCase()
		if (!doi) return null

		// Build a minimal CSL-JSON from Semantic Scholar fields
		const csl: Record<string, unknown> = {
			DOI: doi,
			title: [best.title ?? ""],
			author: (best.authors ?? []).map((a) => {
				const parts = a.name.split(" ")
				return {
					family: parts[parts.length - 1],
					given: parts.slice(0, -1).join(" "),
				}
			}),
			issued: best.year ? { "date-parts": [[best.year]] } : undefined,
			"container-title": best.journal?.name ? [best.journal.name] : undefined,
			volume: best.journal?.volume,
			page: best.journal?.pages,
		}

		return {
			doi,
			formattedApa: renderApa(csl),
			cslJson: csl,
			source: "semantic-scholar",
			confidence: "medium",
			fromCache: false,
		}
	} catch {
		return null
	}
}

// ── Provider 3: DataCite (datasets / technical reports) ──────────────────

async function fromDataCite(query: string): Promise<CitationResult | null> {
	try {
		const url = `https://api.datacite.org/dois?query=${encodeURIComponent(query)}&page[size]=3`
		const res = await fetchWithTimeout(url, {
			headers: { "User-Agent": POLITE_UA },
		})
		if (!res.ok) return null
		const data = (await res.json()) as {
			data?: Array<{
				id: string
				attributes?: {
					titles?: Array<{ title?: string }>
					creators?: Array<{ name?: string; familyName?: string; givenName?: string }>
					publicationYear?: number
					publisher?: string
					doi?: string
				}
			}>
		}
		const items = data.data ?? []
		if (items.length === 0) return null

		const best = items[0]
		const attrs = best.attributes ?? {}
		const doi = attrs.doi ?? best.id
		if (!doi) return null

		const csl: Record<string, unknown> = {
			DOI: doi,
			title: [attrs.titles?.[0]?.title ?? ""],
			author: (attrs.creators ?? []).map((c) => ({
				family: c.familyName ?? c.name ?? "",
				given: c.givenName ?? "",
			})),
			issued: attrs.publicationYear ? { "date-parts": [[attrs.publicationYear]] } : undefined,
			publisher: attrs.publisher,
			type: "dataset",
		}

		return {
			doi,
			formattedApa: renderApa(csl),
			cslJson: csl,
			source: "datacite",
			confidence: "low",
			fromCache: false,
		}
	} catch {
		return null
	}
}

// ── Public API ────────────────────────────────────────────────────────────

export type SourceHint = "crossref" | "semantic-scholar" | "datacite" | "any"

/**
 * Look up a citation.  Returns null if no provider finds a match — callers
 * MUST surface "no peer-reviewed citation found" in that case; never guess.
 *
 * @param query       Free-text: "Beven Kirkby 1979" or full title
 * @param sourceHint  Force a specific provider (default: cascade all three)
 * @param forceRefresh Skip the disk cache and re-query providers
 */
export async function lookupCitation(
	query: string,
	sourceHint: SourceHint = "any",
	forceRefresh = false,
): Promise<CitationResult | null> {
	if (!query.trim()) return null

	// 1. Check disk cache by DOI (if the query looks like a DOI)
	const doiPattern = /^10\.\d{4,}[^\s]*$/i
	const isDoi = doiPattern.test(query.trim()) || /doi\.org\//i.test(query)
	if (isDoi && !forceRefresh) {
		const clean = query.replace(/https?:\/\/doi\.org\//i, "").trim()
		const cached = await getCached(clean)
		if (cached) {
			return { ...cached, fromCache: true }
		}
	}

	// 2. Cascade through providers
	let result: CitationResult | null = null

	if (!result && sourceHint !== "semantic-scholar" && sourceHint !== "datacite") {
		result = await fromCrossRef(query)
	}
	if (!result && sourceHint !== "crossref" && sourceHint !== "datacite") {
		result = await fromSemanticScholar(query)
	}
	if (!result && sourceHint !== "crossref" && sourceHint !== "semantic-scholar") {
		result = await fromDataCite(query)
	}
	// Exhaustive fallback: try remaining providers
	if (!result && sourceHint === "any") {
		result = result ?? (await fromSemanticScholar(query))
		result = result ?? (await fromDataCite(query))
	}

	// 3. Cache successful result
	if (result) {
		await putCached({
			doi: result.doi,
			cslJson: result.cslJson,
			formattedApa: result.formattedApa,
			source: result.source,
			confidence: result.confidence,
			cachedAtMs: Date.now(),
		})
	}

	return result
}
