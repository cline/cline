import fs from "node:fs/promises"
import path from "node:path"

function required(name) {
	const value = process.env[name]
	if (!value) throw new Error(`${name} is required`)
	return value
}

function safeSha(value, length) {
	return value && new RegExp(`^[0-9a-f]{${length}}$`).test(value) ? value : null
}

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical)
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical(value[key])]),
		)
	}
	return value
}

let verification
try {
	verification = JSON.parse(await fs.readFile(required("PHASE1_VERIFICATION_PATH"), "utf8"))
} catch {
	// Bootstrap or verification failures deliberately expose no raw diagnostic.
}

const verificationResult = process.env.PHASE1_VERIFICATION_RESULT === "success" ? "passed" : "failed"
const runtimeResult = process.env.PHASE1_RUNTIME_RESULT === "success" ? "passed" : "failed"
const evidence = canonical({
	schemaVersion: 1,
	phase: "Phase 1 — Learning Pack Packaging, Trust, and Reproducible Distribution",
	generatedAt: new Date().toISOString(),
	os: process.platform,
	book: {
		repository: process.env.PHASE1_BOOK_REPOSITORY ?? null,
		commit: safeSha(process.env.PHASE1_BOOK_COMMIT, 40),
	},
	runtime: {
		repository: "AI-Hydro/AI-Hydro",
		commit: safeSha(process.env.PHASE1_RUNTIME_COMMIT, 40),
	},
	schemaSha256: safeSha(process.env.PHASE1_SCHEMA_SHA256, 64),
	verification: verification ?? null,
	checks: {
		artifactIntegrityAndProvenance: verificationResult,
		realPanelInstallAndExecution: runtimeResult,
	},
	result: verificationResult === "passed" && runtimeResult === "passed" ? "passed" : "failed",
	limitations: [
		"No publisher identity verification or revocation claim",
		"No Python sandboxing claim",
		"No role-based instructor authorization claim",
		"No secure assessment claim",
	],
})
const target = required("PHASE1_EVIDENCE_PATH")
await fs.mkdir(path.dirname(target), { recursive: true })
await fs.writeFile(target, `${JSON.stringify(evidence)}\n`, "utf8")
