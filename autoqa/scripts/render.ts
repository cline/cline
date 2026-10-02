// Human/agent-readable rendering. Plain text, no colour: it is pasted into agent context.
import { expandRequires } from "./load"
import type { PlanOutput } from "./plan"
import type { Case, Catalog, Prereq, Run } from "./types"

function indent(text: string, pad = "      "): string {
	return text
		.trimEnd()
		.split("\n")
		.map((l) => pad + l)
		.join("\n")
}

export function renderPrereq(p: Prereq): string {
	const out = [`PREREQ ${p.id} — ${p.title}`]
	if (p.requires?.length) {
		out.push(`  requires: ${p.requires.join(", ")}`)
	}
	if (p.platforms?.length) {
		out.push(`  platforms: ${p.platforms.join(", ")}`)
	}
	if (p.volatile) {
		out.push("  volatile: re-check before relying on it")
	}
	out.push("  check:")
	if (p.check?.command) {
		out.push(`    command (exit 0 = true):\n${indent(p.check.command)}`)
	}
	if (p.check?.agent) {
		out.push(`    agent:\n${indent(p.check.agent)}`)
	}
	out.push("  establish:")
	if (p.establish?.command) {
		out.push(`    command:\n${indent(p.establish.command)}`)
	}
	if (p.establish?.agent) {
		out.push(`    agent:\n${indent(p.establish.agent)}`)
	}
	return out.join("\n")
}

const HOST_OR_PLATFORM = ["vscode", "jetbrains", "cli", "desktop", "linux", "windows", "macos"]

export function renderCase(c: Case, catalog: Catalog, run?: Run): string {
	const out = [`CASE ${c.id} — ${c.title}`, `  "${c.title} is broken when …"`]
	out.push(
		`  surface: ${c.surface}${c.hosts ? `  hosts: ${c.hosts.join(", ")}` : ""}${c.platforms ? `  platforms: ${c.platforms.join(", ")}` : ""}`,
	)
	out.push(`  priority: ${c.priority}  maturity: ${c.maturity}  ~${c.estimated_minutes ?? "?"} min  isolation: ${c.isolation ?? "fresh-task"}`)
	if (c.tags?.length) {
		out.push(`  tags: ${c.tags.join(", ")}`)
	}
	if (c.refs?.length) {
		out.push(`  refs: ${c.refs.join(", ")}`)
	}
	if (c.known_issues?.length) {
		out.push(`  known issues (a fail here is "still broken"): ${c.known_issues.join(", ")}`)
	}
	const reqs = expandRequires(c.requires, catalog)
	out.push(`  requires: ${c.requires.join(", ")}`)
	out.push(`    expanded: ${reqs.map((r) => (run ? `${run.state[r]?.value === true ? "✓" : "✗"}${r}` : r)).join("  ")}`)
	if (c.provides?.length) {
		out.push(`  provides on pass: ${c.provides.join(", ")}`)
	}
	out.push("  steps:")
	c.steps.forEach((s, i) => {
		const n = String(i + 1).padStart(2)
		if ("do" in s) {
			out.push(`  ${n}. DO      ${s.do}`)
		} else if ("expect" in s) {
			out.push(`  ${n}. EXPECT  ${s.expect}`)
		} else {
			out.push(`  ${n}. CAPTURE screenshots/${s.capture}.png`)
		}
	})
	const notes = c.notes ?? {}
	const noteKeys = Object.keys(notes).filter((k) => !run || k === run.meta.host || k === run.meta.platform || !HOST_OR_PLATFORM.includes(k))
	if (noteKeys.length) {
		out.push("  notes:")
		for (const k of noteKeys) {
			out.push(`    ${k}: ${notes[k]}`)
		}
	}
	out.push(`  file: ${c._file}`)
	return out.join("\n")
}

export function renderPlan(run: Run, out: PlanOutput, catalog: Catalog, all: boolean): string {
	const lines = [`PLAN for ${run.meta.id} (${run.meta.platform}/${run.meta.host}) — ${out.done}/${out.total} cases finished`]
	const trueBits = Object.entries(run.state)
		.filter(([, v]) => v.value)
		.map(([k]) => k)
	lines.push(`  state true: ${trueBits.join(", ") || "(nothing yet)"}`)
	lines.push("")

	if (out.ready.length) {
		lines.push(`READY (${out.ready.length}) — run the top one, then \`autoqa record\`:`)
		const shown = all ? out.ready : out.ready.slice(0, 12)
		for (const r of shown) {
			lines.push(
				`  ${String(r.score).padStart(4)}  ${r.c.id.padEnd(50)} ${r.c.priority} ${r.c.maturity.padEnd(8)} ~${r.c.estimated_minutes ?? "?"}m  [${r.reasons.join(" ")}]`,
			)
		}
		if (!all && out.ready.length > shown.length) {
			lines.push(`  … ${out.ready.length - shown.length} more (use --all)`)
		}
		lines.push("")
		lines.push("NEXT CASE:")
		lines.push(renderCase(out.ready[0].c, catalog, run))
	} else if (out.nextPrereq) {
		const n = out.nextPrereq
		lines.push(`NOTHING READY. Establish this prerequisite next (unblocks ${n.unlocks} cases, value ${n.unlocksValue}):`)
		lines.push(renderPrereq(n.prereq))
		if (n.alsoMissing.length) {
			lines.push(`  those cases also still need: ${n.alsoMissing.join(", ")}`)
		}
		lines.push("")
		lines.push(`When done: \`autoqa state ${run.meta.id} set ${n.prereq.id} true --note "…"\` then \`autoqa plan ${run.meta.id}\` again.`)
		lines.push("If it cannot be established: set it false with a note; blocked cases will be reported as such.")
	} else if (out.retest.length === 0) {
		lines.push("ALL APPLICABLE CASES FINISHED. Write summary.md (see prompts/runner.md § Finishing).")
	}

	if (out.retest.length) {
		lines.push("")
		lines.push(`RETEST QUEUE (${out.retest.length}) — failed in the main pass; run again in isolation at the end of the run:`)
		for (const c of out.retest) {
			lines.push(`  ${c.id.padEnd(50)} isolation: ${c.isolation ?? "fresh-task"}`)
		}
	}

	if (all && out.blocked.length) {
		lines.push("")
		lines.push(`BLOCKED (${out.blocked.length}):`)
		for (const b of out.blocked) {
			lines.push(`  ${String(b.score).padStart(4)}  ${b.c.id.padEnd(50)} missing: ${b.missing.join(", ")}`)
		}
	} else if (out.blocked.length) {
		lines.push("")
		lines.push(`(${out.blocked.length} cases blocked on prerequisites — \`--all\` to list)`)
	}
	return lines.join("\n")
}

const GLYPH: Record<string, string> = { pass: "✓", fail: "✗", flaky: "~", blocked: "⊘", skip: "·" }

export function renderReport(runs: Run[], cases: Case[]): string {
	if (!runs.length) {
		return "no runs yet"
	}
	const lines: string[] = ["RUNS"]
	runs.forEach((r, i) => {
		const counts: Record<string, number> = {}
		for (const res of r.results) {
			counts[res.status] = (counts[res.status] ?? 0) + 1
		}
		const build = Object.entries(r.meta.build ?? {})
			.filter(([, v]) => v)
			.map(([k, v]) => `${k}=${v}`)
			.join(" ")
		const summary =
			Object.entries(counts)
				.map(([k, v]) => `${k}:${v}`)
				.join(" ") || "no results"
		lines.push(`  ${String(i + 1).padStart(2)}. ${r.meta.id.padEnd(34)} ${r.meta.platform}/${r.meta.host}  ${summary}  ${build}`)
	})
	lines.push("")
	lines.push("MATRIX (latest record per case per run; lowercase glyph = isolated retest)")
	lines.push(`  ${"case".padEnd(50)} ${runs.map((_, i) => String(i + 1).padStart(3)).join("")}`)
	const touched = cases.filter((c) => runs.some((r) => r.results.some((x) => x.case === c.id)))
	for (const c of touched) {
		const cells = runs.map((r) => {
			const recs = r.results.filter((x) => x.case === c.id)
			const last = recs[recs.length - 1]
			if (!last) {
				return "   "
			}
			const g = GLYPH[last.status] ?? "?"
			return `  ${last.isolated ? g.toLowerCase() : g}`
		})
		lines.push(`  ${c.id.padEnd(50)} ${cells.join("")}  ${c.maturity}`)
	}
	lines.push("")
	lines.push("  ✓ pass  ✗ fail  ~ flaky  ⊘ blocked  · skip")
	return lines.join("\n")
}
