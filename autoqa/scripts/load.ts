// Loading + validation of cases, prerequisites and runs.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import {
	type Case,
	type CaseFile,
	type Catalog,
	HOSTS,
	ISOLATIONS,
	MATURITIES,
	PLATFORMS,
	type Prereq,
	type PrereqSet,
	PRIORITIES,
	type ResultRecord,
	type Run,
	type RunMeta,
	type RunState,
	SURFACE_HOSTS,
	SURFACES,
	STATUSES,
} from "./types"

/** Root of this (autoqa) repository. */
export const AUTOQA_ROOT = resolve(import.meta.dir, "..")
/** Alias used for relative-path rendering; this repo is its own root. */
export const REPO_ROOT = AUTOQA_ROOT
/**
 * A checkout of cline/cline used only for planning signals (git log on `touches`,
 * .changeset/*.md). Override with CLINE_REPO; defaults to a sibling `../cline`.
 * Everything works without it — the recency signals are simply empty.
 */
export const CLINE_REPO = resolve(process.env.CLINE_REPO ?? join(AUTOQA_ROOT, "..", "cline"))
export const CASES_DIR = join(AUTOQA_ROOT, "cases")
export const RUNS_DIR = join(AUTOQA_ROOT, "runs")
export const PREREQS_FILE = join(AUTOQA_ROOT, "prereqs", "prereqs.yaml")

export function parseYaml<T>(text: string, file: string): T {
	try {
		return Bun.YAML.parse(text) as T
	} catch (error) {
		// Bun's parser gives no position; bisect by line so authors get a usable hint.
		const lines = text.split("\n")
		let hint = ""
		for (let n = 1; n <= lines.length; n++) {
			try {
				Bun.YAML.parse(lines.slice(0, n).join("\n"))
			} catch {
				hint = ` (first failing line ~${n}: ${lines[n - 1]?.trim().slice(0, 100)})`
				break
			}
		}
		throw new Error(`${file}: invalid YAML: ${(error as Error).message}${hint}`)
	}
}

export function readYaml<T>(file: string): T {
	return parseYaml<T>(readFileSync(file, "utf8"), file)
}

export function writeYaml(file: string, value: unknown): void {
	writeFileSync(file, Bun.YAML.stringify(value, null, 2) + "\n")
}

export function listYamlFiles(dir: string): string[] {
	if (!existsSync(dir)) {
		return []
	}
	const out: string[] = []
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry)
		if (statSync(full).isDirectory()) {
			out.push(...listYamlFiles(full))
		} else if (/\.ya?ml$/.test(entry)) {
			out.push(full)
		}
	}
	return out.sort()
}

// ------------------------------------------------------------------ catalog

export function loadCatalog(): Catalog {
	const raw = readYaml<{ prereqs: Prereq[]; sets: PrereqSet[] }>(PREREQS_FILE)
	const prereqs = new Map<string, Prereq>()
	const sets = new Map<string, PrereqSet>()
	for (const p of raw.prereqs ?? []) {
		prereqs.set(p.id, p)
	}
	for (const s of raw.sets ?? []) {
		sets.set(s.id, s)
	}
	return { prereqs, sets }
}

/** Expand sets and transitive `requires` into the flat list of prereq ids a case needs. */
export function expandRequires(ids: string[], catalog: Catalog): string[] {
	const out = new Set<string>()
	const visit = (id: string) => {
		if (out.has(id)) {
			return
		}
		const set = catalog.sets.get(id)
		if (set) {
			for (const inc of set.includes) {
				visit(inc)
			}
			return
		}
		const prereq = catalog.prereqs.get(id)
		if (!prereq) {
			return
		}
		out.add(id)
		for (const req of prereq.requires ?? []) {
			visit(req)
		}
	}
	for (const id of ids) {
		visit(id)
	}
	return [...out]
}

// ------------------------------------------------------------------ cases

export function loadCases(): { cases: Case[]; files: CaseFile[] } {
	const files: CaseFile[] = []
	const cases: Case[] = []
	for (const file of listYamlFiles(CASES_DIR)) {
		const raw = readYaml<CaseFile>(file)
		if (!raw || !Array.isArray(raw.cases)) {
			throw new Error(`${relative(REPO_ROOT, file)}: expected a top-level 'cases' list`)
		}
		for (const c of raw.cases) {
			c._file = relative(REPO_ROOT, file)
			c._feature = raw.feature
			cases.push(c)
		}
		files.push(raw)
	}
	return { cases, files }
}

// ------------------------------------------------------------------ runs

export function runDir(id: string): string {
	return join(RUNS_DIR, id)
}

export function loadRun(id: string): Run {
	const dir = runDir(id)
	if (!existsSync(join(dir, "run.yaml"))) {
		throw new Error(`run '${id}' not found (expected ${relative(REPO_ROOT, dir)}/run.yaml)`)
	}
	const meta = readYaml<RunMeta>(join(dir, "run.yaml"))
	const state = existsSync(join(dir, "state.yaml")) ? (readYaml<RunState>(join(dir, "state.yaml")) ?? {}) : {}
	const results = existsSync(join(dir, "results.yaml")) ? (readYaml<ResultRecord[]>(join(dir, "results.yaml")) ?? []) : []
	return { dir, meta, state, results }
}

export function saveRun(run: Run): void {
	mkdirSync(run.dir, { recursive: true })
	writeYaml(join(run.dir, "run.yaml"), run.meta)
	writeYaml(join(run.dir, "state.yaml"), run.state)
	writeYaml(join(run.dir, "results.yaml"), run.results)
}

export function listRuns(): string[] {
	if (!existsSync(RUNS_DIR)) {
		return []
	}
	return readdirSync(RUNS_DIR)
		.filter((d) => existsSync(join(RUNS_DIR, d, "run.yaml")))
		.sort()
}

export function loadAllRuns(): Run[] {
	return listRuns().map(loadRun)
}

// ------------------------------------------------------------------ validation

export function validate(catalog: Catalog, files: CaseFile[]): string[] {
	const errors: string[] = []
	const seen = new Map<string, string>()

	for (const [id, p] of catalog.prereqs) {
		if (!p.title) {
			errors.push(`prereq ${id}: missing title`)
		}
		if (!p.check?.agent && !p.check?.command) {
			errors.push(`prereq ${id}: needs check.agent or check.command`)
		}
		if (!p.establish?.agent && !p.establish?.command) {
			errors.push(`prereq ${id}: needs establish.agent or establish.command`)
		}
		for (const r of p.requires ?? []) {
			if (!catalog.prereqs.has(r)) {
				errors.push(`prereq ${id}: requires unknown prereq '${r}'`)
			}
		}
		for (const pl of p.platforms ?? []) {
			if (!PLATFORMS.includes(pl)) {
				errors.push(`prereq ${id}: unknown platform '${pl}'`)
			}
		}
	}
	for (const [id, s] of catalog.sets) {
		if (catalog.prereqs.has(id)) {
			errors.push(`set ${id}: id collides with a prereq`)
		}
		for (const inc of s.includes) {
			if (!catalog.prereqs.has(inc) && !catalog.sets.has(inc)) {
				errors.push(`set ${id}: includes unknown id '${inc}'`)
			}
		}
	}

	for (const f of files) {
		const file = f.cases[0]?._file ?? f.feature
		if (!f.feature || !f.title) {
			errors.push(`${file}: case file needs 'feature' and 'title'`)
		}
		for (const c of f.cases) {
			const where = `${c._file} › ${c.id ?? "(no id)"}`
			if (!c.id) {
				errors.push(`${where}: missing id`)
				continue
			}
			if (!c.id.startsWith(`${f.feature}.`)) {
				errors.push(`${where}: id must start with '${f.feature}.'`)
			}
			if (seen.has(c.id)) {
				errors.push(`${where}: duplicate id (also in ${seen.get(c.id)})`)
			}
			seen.set(c.id, c._file)
			if (!c.title) {
				errors.push(`${where}: missing title`)
			}
			if (!SURFACES.includes(c.surface)) {
				errors.push(`${where}: unknown surface '${c.surface}'`)
			}
			if (!PRIORITIES.includes(c.priority)) {
				errors.push(`${where}: priority must be one of ${PRIORITIES.join("|")}`)
			}
			if (!MATURITIES.includes(c.maturity)) {
				errors.push(`${where}: maturity must be one of ${MATURITIES.join("|")}`)
			}
			if (c.isolation && !ISOLATIONS.includes(c.isolation)) {
				errors.push(`${where}: unknown isolation '${c.isolation}'`)
			}
			for (const h of c.hosts ?? []) {
				if (!HOSTS.includes(h)) {
					errors.push(`${where}: unknown host '${h}'`)
				} else if (SURFACES.includes(c.surface) && !SURFACE_HOSTS[c.surface].includes(h)) {
					errors.push(`${where}: host '${h}' is not valid for surface '${c.surface}'`)
				}
			}
			for (const pl of c.platforms ?? []) {
				if (!PLATFORMS.includes(pl)) {
					errors.push(`${where}: unknown platform '${pl}'`)
				}
			}
			if (!Array.isArray(c.requires)) {
				errors.push(`${where}: 'requires' must be a list (use [] for none)`)
			} else {
				for (const r of c.requires) {
					if (!catalog.prereqs.has(r) && !catalog.sets.has(r)) {
						errors.push(`${where}: requires unknown prereq/set '${r}'`)
					}
				}
			}
			for (const p of c.provides ?? []) {
				if (!catalog.prereqs.has(p)) {
					errors.push(`${where}: provides unknown prereq '${p}' (sets are not allowed here)`)
				}
			}
			if (!Array.isArray(c.steps) || c.steps.length === 0) {
				errors.push(`${where}: steps must be a non-empty list`)
			} else {
				let expects = 0
				c.steps.forEach((s, i) => {
					const keys = Object.keys(s ?? {})
					if (keys.length !== 1 || !["do", "expect", "capture"].includes(keys[0])) {
						errors.push(`${where}: step ${i + 1} must have exactly one of do/expect/capture`)
					}
					if (s && "expect" in s) {
						expects++
					}
				})
				if (expects === 0) {
					errors.push(`${where}: needs at least one 'expect' step`)
				}
			}
		}
	}
	return errors
}

export function validateResults(run: Run, cases: Case[]): string[] {
	const ids = new Set(cases.map((c) => c.id))
	const errors: string[] = []
	run.results.forEach((r, i) => {
		if (!ids.has(r.case)) {
			errors.push(`${run.meta.id} results[${i}]: unknown case '${r.case}'`)
		}
		if (!STATUSES.includes(r.status)) {
			errors.push(`${run.meta.id} results[${i}]: bad status '${r.status}'`)
		}
		if (r.status === "fail" && !(r.evidence?.length || r.notes)) {
			errors.push(`${run.meta.id} results[${i}]: a fail needs evidence or notes`)
		}
		if (r.status === "blocked" && !r.blocked_on) {
			errors.push(`${run.meta.id} results[${i}]: blocked needs blocked_on`)
		}
	})
	return errors
}
