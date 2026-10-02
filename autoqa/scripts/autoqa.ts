#!/usr/bin/env bun
// AutoQA command-line tool. Run `bun autoqa/scripts/autoqa.ts help`.
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import {
	CLINE_REPO,
	expandRequires,
	loadAllRuns,
	loadCases,
	loadCatalog,
	loadRun,
	REPO_ROOT,
	runDir,
	saveRun,
	validate,
	validateResults,
} from "./load"
import { appliesToRun, buildSignals, plan, unmetPrereqs } from "./plan"
import { renderCase, renderPlan, renderPrereq, renderReport } from "./render"
import { type Host, HOSTS, type Platform, PLATFORMS, type ResultRecord, type Run, type Status, STATUSES } from "./types"

const HELP = `autoqa — agent-driven QA for Cline product surfaces

  bun autoqa/scripts/autoqa.ts <command> [args]

  validate                          check prereqs/, cases/ and every runs/*/results.yaml
  list [--surface s] [--host h] [--platform p] [--tag t]
                                    list cases (ids, priority, maturity, requires)
  show <case-id>                    print a case with its expanded prerequisites
  prereq <prereq-id>                print a prerequisite's check/establish instructions
  new-run --platform <p> --host <h> [--id <id>] [--surfaces a,b] [--focus id,tag,...]
                                    create runs/<id>/ (id defaults to <date>-<platform>-<host>[-n])
  state <run> set <prereq> true|false [--note "..."]
  state <run>                       show the run's prerequisite state
  plan <run> [--json] [--all]       what to do next: ready cases (scored) or the next prereq
  record <run> <case> <status> [--isolated] [--minutes n] [--evidence a.png,b.txt]
                                    [--notes "..."] [--blocked-on prereq] [--interference case]
  report [--json]                   case × run matrix across all runs
  help
`

function arg(args: string[], name: string): string | undefined {
	const i = args.indexOf(`--${name}`)
	return i >= 0 ? args[i + 1] : undefined
}
function flag(args: string[], name: string): boolean {
	return args.includes(`--${name}`)
}
function list(v?: string): string[] | undefined {
	return v
		? v
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: undefined
}
function now(): string {
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
}
function fail(msg: string): never {
	console.error(`error: ${msg}`)
	process.exit(1)
}
function gitShort(cwd: string): string | undefined {
	try {
		return execSync("git rev-parse --short HEAD", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
	} catch {
		return undefined
	}
}

// ------------------------------------------------------------------ commands

function cmdValidate(): void {
	const catalog = loadCatalog()
	const { cases, files } = loadCases()
	const errors = validate(catalog, files)
	const runs = loadAllRuns()
	for (const run of runs) {
		errors.push(...validateResults(run, cases))
	}
	if (errors.length) {
		for (const e of errors) {
			console.error(`✗ ${e}`)
		}
		process.exit(1)
	}
	console.log(`✓ ${catalog.prereqs.size} prereqs, ${catalog.sets.size} sets, ${cases.length} cases in ${files.length} files, ${runs.length} runs`)
}

function cmdList(args: string[]): void {
	const catalog = loadCatalog()
	let { cases } = loadCases()
	const surface = arg(args, "surface")
	const host = arg(args, "host") as Host | undefined
	const platform = arg(args, "platform") as Platform | undefined
	const tag = arg(args, "tag")
	if (surface) {
		cases = cases.filter((c) => c.surface === surface)
	}
	if (tag) {
		cases = cases.filter((c) => c.tags?.includes(tag))
	}
	if (host || platform) {
		cases = cases.filter((c) => {
			const fake: Run = {
				dir: "",
				meta: { id: "_", created: "", platform: platform ?? c.platforms?.[0] ?? "linux", host: host ?? (c.hosts?.[0] as Host) ?? "vscode" },
				state: {},
				results: [],
			}
			return appliesToRun(c, fake)
		})
	}
	for (const c of cases) {
		const reqs = expandRequires(c.requires, catalog)
		console.log(`${c.priority} ${c.maturity.padEnd(8)} ${c.id.padEnd(50)} ${c.title}  [${reqs.length} prereqs]`)
	}
	console.log(`\n${cases.length} cases`)
}

function cmdShow(id: string): void {
	const catalog = loadCatalog()
	const c = loadCases().cases.find((x) => x.id === id) ?? fail(`unknown case '${id}'`)
	console.log(renderCase(c, catalog))
}

function cmdPrereq(id: string): void {
	const catalog = loadCatalog()
	const p = catalog.prereqs.get(id) ?? fail(`unknown prereq '${id}'`)
	console.log(renderPrereq(p))
}

function cmdNewRun(args: string[]): void {
	const platform = arg(args, "platform") as Platform
	const host = arg(args, "host") as Host
	if (!PLATFORMS.includes(platform)) {
		fail(`--platform must be one of ${PLATFORMS.join("|")}`)
	}
	if (!HOSTS.includes(host)) {
		fail(`--host must be one of ${HOSTS.join("|")}`)
	}
	let id = arg(args, "id")
	if (!id) {
		const base = `${now().slice(0, 10)}-${platform}-${host}`
		id = base
		for (let n = 2; existsSync(runDir(id)); n++) {
			id = `${base}-${n}`
		}
	}
	if (existsSync(runDir(id))) {
		fail(`run '${id}' already exists`)
	}
	const surfaces = list(arg(args, "surfaces")) as Run["meta"]["surfaces"]
	const run: Run = {
		dir: runDir(id),
		meta: {
			id,
			created: now(),
			platform,
			host,
			...(surfaces ? { surfaces } : {}),
			commit: gitShort(REPO_ROOT),
			cline_commit: gitShort(CLINE_REPO),
			build: { extension: "", cli: "", ide: "", desktop: "" },
			focus: list(arg(args, "focus")) ?? [],
			notes: "",
		},
		state: {},
		results: [],
	}
	saveRun(run)
	mkdirSync(join(run.dir, "screenshots"), { recursive: true })
	writeFileSync(
		join(run.dir, "journal.md"),
		`# Journal — ${id}\n\n_${now()}_ run created (${platform}/${host}, commit ${run.meta.commit ?? "?"})\n`,
	)
	console.log(`created ${relative(REPO_ROOT, run.dir)}\n\nNext: fill build versions in run.yaml, then \`autoqa plan ${id}\``)
}

function cmdState(runId: string, args: string[]): void {
	const run = loadRun(runId)
	const catalog = loadCatalog()
	if (args[0] === "set") {
		const [, prereq, value] = args
		if (!catalog.prereqs.has(prereq)) {
			fail(`unknown prereq '${prereq}' (sets cannot be set directly; set their members)`)
		}
		if (value !== "true" && value !== "false") {
			fail("value must be true or false")
		}
		const note = arg(args, "note")
		run.state[prereq] = { value: value === "true", at: now(), ...(note ? { note } : {}) }
		saveRun(run)
		console.log(`${prereq} = ${value}`)
		return
	}
	for (const id of catalog.prereqs.keys()) {
		const s = run.state[id]
		console.log(`${s ? (s.value ? "✓" : "✗") : "·"} ${id.padEnd(34)} ${s?.note ?? ""}`)
	}
}

function cmdPlan(runId: string, args: string[]): void {
	const run = loadRun(runId)
	const catalog = loadCatalog()
	const { cases } = loadCases()
	const out = plan(run, cases, catalog, buildSignals(run, loadAllRuns()))
	if (flag(args, "json")) {
		const next = out.nextPrereq
		console.log(
			JSON.stringify(
				{
					run: run.meta.id,
					progress: { done: out.done, total: out.total },
					ready: out.ready.map((r) => ({ id: r.c.id, score: r.score, reasons: r.reasons, minutes: r.c.estimated_minutes })),
					retest: out.retest.map((c) => c.id),
					next_prereq: next ? { id: next.prereq.id, unlocks: next.unlocks, value: next.unlocksValue, also_missing: next.alsoMissing } : null,
					blocked: out.blocked.map((b) => ({ id: b.c.id, score: b.score, missing: b.missing })),
				},
				null,
				2,
			),
		)
		return
	}
	console.log(renderPlan(run, out, catalog, flag(args, "all")))
}

function cmdRecord(runId: string, caseId: string, status: string, args: string[]): void {
	const run = loadRun(runId)
	const catalog = loadCatalog()
	const { cases } = loadCases()
	const c = cases.find((x) => x.id === caseId) ?? fail(`unknown case '${caseId}'`)
	if (!STATUSES.includes(status as Status)) {
		fail(`status must be one of ${STATUSES.join("|")}`)
	}
	const rec: ResultRecord = { case: caseId, status: status as Status, at: now() }
	if (flag(args, "isolated")) {
		rec.isolated = true
	}
	const minutes = arg(args, "minutes")
	if (minutes) {
		rec.duration_minutes = Number(minutes)
	}
	const evidence = list(arg(args, "evidence"))
	if (evidence) {
		rec.evidence = evidence
	}
	const notes = arg(args, "notes")
	if (notes) {
		rec.notes = notes
	}
	const blockedOn = arg(args, "blocked-on")
	if (blockedOn) {
		rec.blocked_on = blockedOn
	}
	const interference = arg(args, "interference")
	if (interference) {
		rec.suspected_interference = interference
	}
	if (rec.status === "fail" && !rec.evidence?.length && !rec.notes) {
		fail("a fail needs --evidence and/or --notes")
	}
	if (rec.status === "blocked" && !rec.blocked_on) {
		const missing = unmetPrereqs(c, run, catalog)
		if (missing.length === 1) {
			rec.blocked_on = missing[0]
		} else {
			fail(`blocked needs --blocked-on (unmet: ${missing.join(", ") || "none?"})`)
		}
	}
	run.results.push(rec)
	const flipped: string[] = []
	if (rec.status === "pass") {
		for (const p of c.provides ?? []) {
			if (run.state[p]?.value !== true) {
				run.state[p] = { value: true, at: now(), note: `provided by ${caseId}` }
				flipped.push(p)
			}
		}
	}
	saveRun(run)
	let msg = `recorded ${caseId} = ${status}${rec.isolated ? " (isolated)" : ""}`
	if (flipped.length) {
		msg += `\n  now true: ${flipped.join(", ")}`
	}
	if (rec.status === "fail" && !rec.isolated) {
		msg += `\n  queued for isolated retest (isolation: ${c.isolation ?? "fresh-task"})`
	}
	console.log(msg)
}

function cmdReport(args: string[]): void {
	const runs = loadAllRuns()
	const { cases } = loadCases()
	if (flag(args, "json")) {
		console.log(JSON.stringify(runs.map((r) => ({ ...r.meta, results: r.results })), null, 2))
		return
	}
	console.log(renderReport(runs, cases))
}

// ------------------------------------------------------------------ main

const [cmd, ...rest] = process.argv.slice(2)
switch (cmd) {
	case "validate":
		cmdValidate()
		break
	case "list":
		cmdList(rest)
		break
	case "show":
		cmdShow(rest[0] ?? fail("show needs a case id"))
		break
	case "prereq":
		cmdPrereq(rest[0] ?? fail("prereq needs a prereq id"))
		break
	case "new-run":
		cmdNewRun(rest)
		break
	case "state": {
		// accept both `state <run> set …` and `state set <run> …`
		const [a, b, ...tail] = rest
		if (a === "set") {
			cmdState(b ?? fail("state set needs a run id"), ["set", ...tail])
		} else {
			cmdState(a ?? fail("state needs a run id"), rest.slice(1))
		}
		break
	}
	case "plan":
		cmdPlan(rest[0] ?? fail("plan needs a run id"), rest.slice(1))
		break
	case "record":
		cmdRecord(
			rest[0] ?? fail("record needs <run> <case> <status>"),
			rest[1] ?? fail("record needs a case id"),
			rest[2] ?? fail("record needs a status"),
			rest.slice(3),
		)
		break
	case "report":
		cmdReport(rest)
		break
	case "help":
	case undefined:
	case "--help":
	case "-h":
		console.log(HELP)
		break
	default:
		fail(`unknown command '${cmd}'\n${HELP}`)
}
