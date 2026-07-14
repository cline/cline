import { expect } from "chai"
import * as fs from "fs"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import {
	listSessionIds,
	loadClaimSurface,
	loadExperimentSurface,
	loadReplaySurface,
	resolveSessionJsonPath,
} from "../sessionSurfaces"

describe("sessionSurfaces", () => {
	let home: string

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "aihydro-surfaces-"))
		fs.mkdirSync(path.join(home, "sessions"), { recursive: true })
	})

	afterEach(() => {
		fs.rmSync(home, { recursive: true, force: true })
	})

	function writeSession(id: string, raw: Record<string, unknown>) {
		const file = path.join(home, "sessions", `${id}.json`)
		fs.writeFileSync(file, JSON.stringify(raw, null, 2))
		return file
	}

	it("resolves canonical session files and explicit capsule paths", () => {
		const canonical = writeSession("01031500", { session_id: "01031500" })
		const capsuleDir = path.join(home, "exports", "capsule_02000000")
		fs.mkdirSync(capsuleDir, { recursive: true })
		const capsule = path.join(capsuleDir, "session.json")
		fs.writeFileSync(capsule, JSON.stringify({ session_id: "02000000" }))

		expect(resolveSessionJsonPath("01031500", home)).to.equal(canonical)
		expect(resolveSessionJsonPath(capsuleDir, home)).to.equal(capsule)
		expect(resolveSessionJsonPath("missing", home)).to.equal(undefined)
	})

	it("loads experiments from wrapped session slots and reports available ids", () => {
		writeSession("s1", {
			session_id: "s1",
			_experiments: {
				data: {
					exp_b: { defn: { name: "B", tool: "run_model", features: ["f2"], metrics: ["nse"] }, results: null },
					exp_a: {
						defn: {
							experiment_id: "exp_a",
							name: "A",
							tool: "score_model",
							features: ["f1"],
							metrics: ["kge"],
							params: { alpha: 1 },
							params_hash: "abc",
							created_at: "2026-06-25T00:00:00Z",
						},
						results: {
							status: "complete",
							run_ids: { f1: "run.f1" },
							cells: { f1: { kge: { value: 0.73, ci_low: 0.7, ci_high: 0.76 } } },
							errors: {},
							n_success: 1,
							n_error: 0,
							completed_at: "2026-06-25T00:10:00Z",
						},
					},
				},
			},
		})

		const surface = loadExperimentSurface("s1", "", home)
		expect(surface.experiment_id).to.equal("exp_a")
		expect(surface.availableExperimentIds).to.deep.equal(["exp_a", "exp_b"])
		expect(surface.defn.name).to.equal("A")
		expect(surface.results?.status).to.equal("complete")
		expect(surface.results?.cells.f1.kge.value).to.equal(0.73)
	})

	it("normalizes replay maps into chronological timeline entries", () => {
		writeSession("s2", {
			session_id: "s2",
			_run_log: {
				data: {
					run2: { tool_name: "fetch", timestamp: "2026-06-25T00:02:00Z", key_outputs: { q: 2 } },
					run1: { tool: "delineate", timestamp: "2026-06-25T00:01:00Z", key_outputs: { area_km2: 10 } },
				},
			},
		})

		const replay = loadReplaySurface("s2", home)
		expect(replay.source).to.equal("session")
		expect(replay.entries.map((entry) => entry.run_id)).to.deep.equal(["run1", "run2"])
		expect(replay.entries[0].tool_name).to.equal("delineate")
		expect(replay.entries[1].key_outputs.q).to.equal(2)
	})

	it("normalizes nested legacy replay maps from hydro slot storage", () => {
		writeSession("legacy", {
			session_id: "legacy",
			_run_log: {
				__legacy__: {
					"": {
						"q.1": {
							run_id: "q.1",
							tool_name: "fetch_streamflow_data",
							timestamp: "2026-06-27T21:38:05Z",
							key_outputs: { n_days: 7671 },
						},
						"sigs.1": {
							run_id: "sigs.1",
							tool_name: "extract_hydrological_signatures",
							timestamp: "2026-06-27T21:38:15Z",
							key_outputs: { baseflow_index: 0.44 },
						},
					},
				},
			},
		})

		const replay = loadReplaySurface("legacy", home)
		expect(replay.entries.map((entry) => entry.run_id)).to.deep.equal(["q.1", "sigs.1"])
		expect(replay.entries.map((entry) => entry.tool_name)).to.deep.equal([
			"fetch_streamflow_data",
			"extract_hydrological_signatures",
		])
	})

	it("backfills replay with stored slot results when run_log is partial", () => {
		writeSession("partial-replay", {
			session_id: "partial-replay",
			_run_log: {
				data: {
					"q.1": { run_id: "q.1", tool_name: "fetch_streamflow_data", timestamp: "2024-01-01T00:00:00Z" },
				},
			},
			streamflow: {
				__legacy__: {
					"": { data: { n_days: 10 }, meta: { tool: "fetch_streamflow_data", computed_at: "2024-01-01T00:00:00Z" } },
				},
			},
			baseflow: {
				__legacy__: {
					"": { data: { bfi: 0.44 }, meta: { tool: "separate_baseflow", computed_at: "2024-01-02T00:00:00Z" } },
				},
			},
		})

		const surface = loadReplaySurface("partial-replay", home)
		expect(surface.entries.map((entry) => entry.tool_name)).to.deep.equal(["fetch_streamflow_data", "separate_baseflow"])
		expect(surface.entries[1].run_id).to.equal("baseflow.stored")
	})

	it("loads replay entries from capsule session.json", () => {
		const capsuleDir = path.join(home, "exports", "capsule_s3")
		fs.mkdirSync(capsuleDir, { recursive: true })
		fs.writeFileSync(
			path.join(capsuleDir, "session.json"),
			JSON.stringify({
				session_id: "s3",
				_run_log: [{ run_id: "r1", tool_name: "tool", timestamp: "t", key_outputs: {} }],
			}),
		)

		const replay = loadReplaySurface(capsuleDir, home)
		expect(replay.source).to.equal("capsule")
		expect(replay.capsule_path).to.equal(capsuleDir)
		expect(replay.entries).to.have.length(1)
	})

	it("loads persisted claims from canonical and wrapped claim slots", () => {
		writeSession("claims", {
			session_id: "claims",
			claims: {
				"claim-a": {
					statement: "KGE is acceptable in two basins.",
					claim_type: "model_performance",
					status: "tested",
					confidence: "medium",
					evidence_spans: [{ source_type: "run", source_id: "run.01031500.calibration", metric_ref: "kge" }],
					limitations: ["single smoke fixture"],
				},
			},
			_claims: {
				data: {
					"claim-b": {
						claim: "RMSE differs across basins.",
						claim_type: "empirical_result",
						status: "weakly_supported",
						confidence: "low",
					},
				},
			},
		})

		const surface = loadClaimSurface("claims", home)
		expect(surface.claims.map((claim) => claim.claimId)).to.deep.equal(["claim-a", "claim-b"])
		expect(surface.claims[0].evidenceSpans[0].sourceId).to.equal("run.01031500.calibration")
		expect(surface.claims[1].statement).to.equal("RMSE differs across basins.")
	})

	it("synthesizes evidence candidates from replay runs when no formal claims exist", () => {
		writeSession("candidate", {
			session_id: "candidate",
			claims: {},
			_run_log: {
				data: {
					"q.1": {
						run_id: "q.1",
						tool_name: "fetch_streamflow_data",
						timestamp: "2026-06-27T21:38:05Z",
						key_outputs: { n_days: 7671 },
					},
				},
			},
		})

		const surface = loadClaimSurface("candidate", home)
		expect(surface.claims).to.have.length(1)
		expect(surface.claims[0].claimId).to.equal("candidate:q.1")
		expect(surface.claims[0].claimType).to.equal("evidence_candidate")
		expect(surface.claims[0].evidenceSpans[0].sourceId).to.equal("q.1")
	})

	it("flags supported claims without evidence and still shows unlinked run candidates", () => {
		writeSession("claim-gap", {
			session_id: "claim-gap",
			claims: {
				c1: {
					id: "c1",
					claim: "This should not be citable without evidence.",
					claim_type: "empirical_result",
					status: "supported",
					confidence: "medium",
					evidence_spans: [],
					limitations: [],
				},
			},
			_run_log: {
				data: {
					"run.1": {
						run_id: "run.1",
						tool_name: "extract_hydrological_signatures",
						timestamp: "2024-01-01T00:00:00Z",
						key_outputs: { baseflow_index: 0.44 },
					},
				},
			},
		})

		const surface = loadClaimSurface("claim-gap", home)
		const claim = surface.claims.find((item) => item.claimId === "c1")
		expect(claim?.status).to.equal("weakly_supported")
		expect(claim?.limitations.join(" ")).to.contain("No evidence spans")
		expect(surface.claims.map((item) => item.claimId)).to.include("candidate:run.1")
	})

	it("loads legacy sessions containing non-standard NaN tokens", () => {
		const dir = path.join(home, "sessions")
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(
			path.join(dir, "nan-session.json"),
			'{"session_id":"nan-session","inundation":{"__legacy__":{"":{"data":{"channel_slope_est":NaN},"meta":{"tool":"compute_inundation","computed_at":"2026-01-01T00:00:00Z"}}}}}',
		)

		const surface = loadReplaySurface("nan-session", home)

		expect(surface.session_id).to.equal("nan-session")
		expect(surface.entries).to.have.length(1)
		expect(surface.entries[0].key_outputs.channel_slope_est).to.equal(null)
	})

	it("lists recent session ids by mtime", () => {
		writeSession("old", { session_id: "old" })
		writeSession("new", { session_id: "new" })
		fs.utimesSync(path.join(home, "sessions", "old.json"), new Date(1000), new Date(1000))
		fs.utimesSync(path.join(home, "sessions", "new.json"), new Date(2000), new Date(2000))
		expect(listSessionIds(home)).to.deep.equal(["new", "old"])
	})
})
