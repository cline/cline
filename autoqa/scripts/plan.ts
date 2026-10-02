// Planner: given a run's platform/host/state/results, decide what to do next.
import { execSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { CLINE_REPO, expandRequires } from "./load"
import { type Case, type Catalog, type Prereq, type Run, SURFACE_HOSTS } from "./types"

export interface ScoredCase {
	c: Case
	score: number
	reasons: string[]
	missing: string[] // unmet prereq ids (empty when ready)
}

export interface PlanOutput {
	ready: ScoredCase[]
	blocked: ScoredCase[]
	retest: Case[] // failed, not yet retested in isolation
	nextPrereq?: { prereq: Prereq; unlocks: number; unlocksValue: number; alsoMissing: string[] }
	done: number
	total: number
}

// ------------------------------------------------------------------ applicability

export function appliesToRun(c: Case, run: Run): boolean {
	if (c.platforms && !c.platforms.includes(run.meta.platform)) {
		return false
	}
	const hosts = c.hosts ?? SURFACE_HOSTS[c.surface] ?? []
	if (!hosts.includes(run.meta.host)) {
		return false
	}
	if (run.meta.surfaces?.length && !run.meta.surfaces.includes(c.surface)) {
		return false
	}
	return true
}

export function unmetPrereqs(c: Case, run: Run, catalog: Catalog): string[] {
	return expandRequires(c.requires, catalog).filter((id) => {
		const p = catalog.prereqs.get(id)
		if (p?.platforms && !p.platforms.includes(run.meta.platform)) {
			return false // not meaningful here → treat as satisfied
		}
		return run.state[id]?.value !== true
	})
}

// ------------------------------------------------------------------ signals

/** Paths changed in the last `days` days in the cline/cline checkout (CLINE_REPO), for the recency signal. */
export function recentlyChangedPaths(days = 14): Set<string> {
	if (!existsSync(join(CLINE_REPO, ".git"))) {
		return new Set()
	}
	try {
		const out = execSync(`git log --since="${days} days ago" --name-only --pretty=format:`, {
			cwd: CLINE_REPO,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
		return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))
	} catch {
		return new Set()
	}
}

/** Lower-cased text of every .changeset/*.md in the cline/cline checkout, for tag matching. */
export function changesetText(): string {
	const dir = join(CLINE_REPO, ".changeset")
	if (!existsSync(dir)) {
		return ""
	}
	return readdirSync(dir)
		.filter((f) => f.endsWith(".md") && f !== "README.md")
		.map((f) => readFileSync(join(dir, f), "utf8"))
		.join("\n")
		.toLowerCase()
}

const PRIORITY_SCORE: Record<string, number> = { P0: 40, P1: 25, P2: 12, P3: 4 }

export interface Signals {
	changed: Set<string>
	changesets: string
	/** case id → statuses from earlier runs (any platform/host) */
	history: Map<string, string[]>
	focus: Set<string>
}

export function buildSignals(run: Run, allRuns: Run[]): Signals {
	const history = new Map<string, string[]>()
	for (const r of allRuns) {
		if (r.meta.id === run.meta.id) {
			continue
		}
		for (const res of r.results) {
			history.set(res.case, [...(history.get(res.case) ?? []), res.status])
		}
	}
	return {
		changed: recentlyChangedPaths(),
		changesets: changesetText(),
		history,
		focus: new Set((run.meta.focus ?? []).map((f) => f.toLowerCase())),
	}
}

export function scoreCase(c: Case, s: Signals): { score: number; reasons: string[] } {
	let score = PRIORITY_SCORE[c.priority] ?? 0
	const reasons: string[] = [`${c.priority}`]

	if (s.focus.size) {
		const hit = s.focus.has(c.id.toLowerCase()) || (c.tags ?? []).some((t) => s.focus.has(t.toLowerCase()))
		if (hit) {
			score += 100
			reasons.push("focus")
		}
	}
	if (c.refs?.length) {
		score += 30
		reasons.push(`refs:${c.refs.length}`)
	}
	const hist = s.history.get(c.id) ?? []
	if (hist.includes("fail")) {
		score += 35
		reasons.push("failed-before")
	} else if (hist.includes("flaky")) {
		score += 20
		reasons.push("flaky-before")
	} else if (hist.includes("blocked")) {
		score += 8
		reasons.push("blocked-before")
	}
	if (c.touches?.length) {
		const hits = c.touches.filter((t) => [...s.changed].some((p) => p.startsWith(t)))
		if (hits.length) {
			score += Math.min(30, 10 * hits.length)
			reasons.push(`recent-change:${hits.length}`)
		}
	}
	if (c.tags?.length && s.changesets) {
		const hits = c.tags.filter((t) => {
			const lower = t.toLowerCase()
			return s.changesets.includes(lower) || s.changesets.includes(lower.replace(/-/g, " "))
		})
		if (hits.length) {
			score += Math.min(15, 5 * hits.length)
			reasons.push(`changeset:${hits.join(",")}`)
		}
	}
	if (c.maturity === "trusted") {
		score += 3
	}
	// cheap first inside a tier
	score -= Math.min(10, (c.estimated_minutes ?? 5) / 2)
	return { score: Math.round(score), reasons }
}

// ------------------------------------------------------------------ plan

/** A case is finished for this run when it passed/skipped/flaky, or failed (fail goes to the retest queue). */
function isTerminal(c: Case, run: Run): boolean {
	const records = run.results.filter((r) => r.case === c.id)
	if (!records.length) {
		return false
	}
	return records.some((r) => r.status === "pass" || r.status === "skip" || r.status === "flaky" || r.status === "fail")
}

export function plan(run: Run, cases: Case[], catalog: Catalog, signals: Signals): PlanOutput {
	const applicable = cases.filter((c) => appliesToRun(c, run))

	const ready: ScoredCase[] = []
	const blocked: ScoredCase[] = []
	for (const c of applicable) {
		if (isTerminal(c, run)) {
			continue
		}
		const missing = unmetPrereqs(c, run, catalog)
		const { score, reasons } = scoreCase(c, signals)
		;(missing.length ? blocked : ready).push({ c, score, reasons, missing })
	}
	const byScore = (a: ScoredCase, b: ScoredCase) => b.score - a.score || a.c.id.localeCompare(b.c.id)
	ready.sort(byScore)
	blocked.sort(byScore)

	// failed in the main pass and not yet retested in isolation
	const retest = applicable.filter((c) => {
		const recs = run.results.filter((r) => r.case === c.id)
		return recs.some((r) => r.status === "fail" && !r.isolated) && !recs.some((r) => r.isolated)
	})

	// Next prerequisite: the unmet prereq that is establishable now (its own requires are met)
	// and unblocks the most value. Ties → the one whose unblocked cases have fewer other gaps.
	let nextPrereq: PlanOutput["nextPrereq"]
	if (!ready.length && blocked.length) {
		const tally = new Map<string, { unlocks: number; value: number; alsoMissing: Set<string> }>()
		for (const b of blocked) {
			for (const m of b.missing) {
				const t = tally.get(m) ?? { unlocks: 0, value: 0, alsoMissing: new Set<string>() }
				t.unlocks++
				t.value += b.score / b.missing.length
				for (const other of b.missing) {
					if (other !== m) {
						t.alsoMissing.add(other)
					}
				}
				tally.set(m, t)
			}
		}
		const entries = [...tally.entries()]
			.map(([id, t]) => ({ id, ...t, prereq: catalog.prereqs.get(id) }))
			.filter((x): x is typeof x & { prereq: Prereq } => Boolean(x.prereq))
		const establishable = entries
			.filter((x) => (x.prereq.requires ?? []).every((r) => run.state[r]?.value === true || !catalog.prereqs.has(r)))
			.sort((a, b) => b.value - a.value || a.alsoMissing.size - b.alsoMissing.size)
		const best = establishable[0] ?? entries.sort((a, b) => b.value - a.value)[0]
		if (best) {
			nextPrereq = {
				prereq: best.prereq,
				unlocks: best.unlocks,
				unlocksValue: Math.round(best.value),
				alsoMissing: [...best.alsoMissing],
			}
		}
	}

	return {
		ready,
		blocked,
		retest,
		nextPrereq,
		done: applicable.filter((c) => isTerminal(c, run)).length,
		total: applicable.length,
	}
}
