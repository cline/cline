import { fireEvent, render, screen, within } from "@testing-library/react"
import { act } from "react"
import { describe, expect, it } from "vitest"
import { ExperimentTable } from "../ExperimentTable"

const CALIBRATION_CELLS = {
	"01031500": { kge: { value: 0.78 }, nse: { value: 0.72 }, rmse: { value: 12.4 } },
	"01109000": { kge: { value: 0.64 }, nse: { value: 0.59 }, rmse: { value: 18.9 } },
	"01491000": { kge: { value: 0.83 }, nse: { value: 0.8 }, rmse: { value: 9.7 } },
}

const VALIDATION_CELLS = {
	"01031500": { kge: { value: 0.69 }, nse: { value: 0.63 }, rmse: { value: 14.8 } },
	"01109000": { kge: { value: 0.55 }, nse: { value: 0.49 }, rmse: { value: 21.3 } },
	"01491000": { kge: { value: 0.79 }, nse: { value: 0.75 }, rmse: { value: 11.2 } },
}

function loadPrimaryExperiment() {
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "experiment_table_data",
					session_id: "demo-reproducibility-cockpit",
					experiment_id: "panel_smoke_exp",
					defn: {
						experiment_id: "panel_smoke_exp",
						name: "Panel smoke experiment",
						tool: "run_experiment",
						features: ["01031500", "01109000", "01491000"],
						metrics: ["kge", "nse", "rmse"],
						params: {},
						params_hash: "demo-smoke",
						created_at: "2026-06-25T11:54:00Z",
					},
					results: {
						status: "complete",
						run_ids: {
							"01031500": "run.01031500.calibration",
							"01109000": "run.01109000.calibration",
							"01491000": "run.01491000.calibration",
						},
						cells: CALIBRATION_CELLS,
						errors: {},
						n_success: 3,
						n_error: 0,
						completed_at: "2026-06-25T12:00:00Z",
					},
					available_experiment_ids: ["panel_smoke_exp", "panel_smoke_exp_validation"],
					session_path: "demo-reproducibility-cockpit",
				},
			}),
		)
	})
}

function loadCompareExperiment() {
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "experiment_table_data",
					request_tag: "compare",
					session_id: "demo-reproducibility-cockpit",
					experiment_id: "panel_smoke_exp_validation",
					defn: {
						experiment_id: "panel_smoke_exp_validation",
						name: "Panel smoke experiment (validation split)",
						tool: "run_experiment",
						features: ["01031500", "01109000", "01491000"],
						metrics: ["kge", "nse", "rmse"],
						params: {},
						params_hash: "demo-smoke-val",
						created_at: "2026-06-25T12:10:00Z",
					},
					results: {
						status: "complete",
						run_ids: {},
						cells: VALIDATION_CELLS,
						errors: {},
						n_success: 3,
						n_error: 0,
						completed_at: "2026-06-25T12:14:00Z",
					},
					available_experiment_ids: ["panel_smoke_exp", "panel_smoke_exp_validation"],
					session_path: "demo-reproducibility-cockpit",
				},
			}),
		)
	})
}

describe("ExperimentTable Plots tab", () => {
	it("renders a distribution chart per metric with all basin points", () => {
		render(<ExperimentTable />)
		loadPrimaryExperiment()

		fireEvent.click(screen.getByRole("button", { name: /Plots/ }))

		// One chart heading per metric (kge, nse, rmse)
		expect(screen.getByText("kge")).toBeInTheDocument()
		expect(screen.getByText("nse")).toBeInTheDocument()
		expect(screen.getByText("rmse")).toBeInTheDocument()

		// Each chart reports its sample size — real n, not a placeholder.
		expect(document.body.textContent).toContain("n=3")

		// Every basin should have a plotted point (an SVG <circle>) somewhere
		// in the Plots tab — 3 metrics x 3 basins = 9 circles.
		const circles = document.querySelectorAll("svg circle")
		expect(circles.length).toBe(9)
	})

	it("shows the compare dropdown and renders real per-basin deltas when a second experiment is selected", async () => {
		render(<ExperimentTable />)
		loadPrimaryExperiment()
		fireEvent.click(screen.getByRole("button", { name: /Plots/ }))

		const select = screen.getByDisplayValue(/Select an experiment/)
		fireEvent.change(select, { target: { value: "panel_smoke_exp_validation" } })
		loadCompareExperiment()

		// Real delta for 01031500/kge: 0.69 - 0.78 = -0.09 (regression on a
		// higher-is-better metric -> should NOT be colored as an improvement).
		const baselineSpan = await screen.findByTitle("0.7800 → 0.6900")
		const kgeCell = baselineSpan.closest("td")
		expect(kgeCell).not.toBeNull()
		expect(kgeCell?.textContent).toContain("-0.0900")

		// A real improvement: 01491000/rmse: 11.2000 vs baseline 9.7000 is a
		// REGRESSION for rmse (lower-is-better) -> delta should be positive.
		const rmseBaselineSpan = screen.getByTitle("9.7000 → 11.2000")
		const rmseCell = rmseBaselineSpan.closest("td")
		expect(rmseCell).not.toBeNull()
		expect(within(rmseCell as HTMLElement).getByText(/\+1\.5000/)).toBeInTheDocument()
	})
})
