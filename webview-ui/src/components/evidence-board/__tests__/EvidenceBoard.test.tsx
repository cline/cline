import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { LedgerContextProvider } from "@/context/LedgerContext"
import { EvidenceBoard } from "../EvidenceBoard"

const getLedgerStateMock = vi.fn()
const subscribeToClaimUpdatesMock = vi.fn().mockReturnValue(() => {})

vi.mock("@/services/grpc-client", () => ({
	LedgerServiceClient: {
		getLedgerState: (...args: unknown[]) => getLedgerStateMock(...args),
		subscribeToClaimUpdates: (...args: unknown[]) => subscribeToClaimUpdatesMock(...args),
	},
}))

// EvidenceBoard posts directly via PLATFORM_CONFIG (open_replay,
// open_experiment, aihydro-ledger-agent-task), not through grpc-client. Mock
// it so tests can capture the real, internally-generated requestId and
// simulate the host's response.
const platformPostMessageMock = vi.fn()
vi.mock("@/config/platform.config", () => ({
	PLATFORM_CONFIG: { postMessage: (...args: unknown[]) => platformPostMessageMock(...args) },
}))

const SUPPORTED_CLAIM = {
	claimId: "claim-kge-acceptable",
	sessionId: "demo-reproducibility-cockpit",
	statement: "The calibration experiment produced acceptable KGE values for two of three basins.",
	status: "tested",
	claimType: "model_performance",
	confidence: "medium",
	createdAt: "2026-06-25T12:02:00Z",
	updatedAt: "2026-06-25T12:05:00Z",
	evidenceSpans: [
		{
			sourceType: "run",
			sourceId: "run.01031500.calibration",
			metricRef: "panel_smoke_exp.kge",
			description: "KGE=0.78 with CI [0.71, 0.84]",
		},
	],
	limitations: ["Only two of three basins meet the illustrative KGE threshold."],
}

const CANDIDATE_CLAIM = {
	claimId: "candidate:run.01109000.calibration",
	sessionId: "demo-reproducibility-cockpit",
	statement: "Evidence candidate from calibrate_model: review outputs before turning this run into a formal scientific claim.",
	status: "proposed",
	claimType: "evidence_candidate",
	confidence: "",
	createdAt: "2026-06-25T11:59:00Z",
	updatedAt: "2026-06-25T11:59:00Z",
	evidenceSpans: [{ sourceType: "run", sourceId: "run.01109000.calibration", metricRef: "", description: "" }],
	limitations: ["Auto-generated evidence candidate; not a user-authored scientific claim."],
}

function renderBoard() {
	return render(
		<LedgerContextProvider>
			<EvidenceBoard />
		</LedgerContextProvider>,
	)
}

describe("EvidenceBoard", () => {
	it("loads claims on mount and renders a status lane per claim, with synthesized candidates visually distinct from recorded claims", async () => {
		getLedgerStateMock.mockResolvedValue({
			sessionId: "demo-reproducibility-cockpit",
			claims: [SUPPORTED_CLAIM, CANDIDATE_CLAIM],
			updatedAtMs: Date.now(),
		})

		renderBoard()

		await waitFor(() => expect(screen.getByText("2 claims")).toBeInTheDocument())

		// Real, non-fabricated claim -> its own status lane + claim-type badge.
		// "Tested" legitimately renders twice (the lane header + the
		// auto-selected claim's detail-pane status card).
		expect(screen.getAllByText("Tested").length).toBeGreaterThan(0)
		expect(screen.getAllByText("model").length).toBeGreaterThan(0)

		// F-10 verification: the synthesized/candidate claim is F-10's concern —
		// confirm it renders with a visually distinct claim-type badge ("evidence
		// candidate") rather than blending in with recorded, user-authored claims.
		expect(screen.getAllByText("evidence candidate").length).toBeGreaterThan(0)

		// Real interaction: clicking the second claim's card switches the detail
		// pane to ITS limitations (not the first/auto-selected claim's). See the
		// bullet-prefix note above for why this is a function matcher.
		fireEvent.click(screen.getByText(CANDIDATE_CLAIM.statement))
		expect(
			await screen.findByText(
				(_, element) =>
					element?.tagName === "P" &&
					element.textContent === "• Auto-generated evidence candidate; not a user-authored scientific claim.",
			),
		).toBeInTheDocument()
	})

	it("auto-selects the only claim and shows its evidence spans and limitations in the detail pane", async () => {
		getLedgerStateMock.mockResolvedValue({
			sessionId: "demo-reproducibility-cockpit",
			claims: [SUPPORTED_CLAIM],
			updatedAtMs: Date.now(),
		})

		renderBoard()

		await waitFor(() => expect(screen.getByText("1 claims")).toBeInTheDocument())

		// With a single claim, EvidenceBoard's own useEffect auto-selects it —
		// no click needed, and the statement legitimately appears twice (the
		// kanban card + the detail pane), so we assert on detail-pane-only
		// content instead of the (ambiguous) statement text.

		// Real evidence span data, not a placeholder. The rendered <p> is
		// `• {limitation}` (bullet + expression as sibling text nodes), so its
		// full text content includes the bullet — match with a function
		// matcher rather than an exact string that would need to include it.
		expect(
			await screen.findByText(
				(_, element) =>
					element?.tagName === "P" &&
					element.textContent === "• Only two of three basins meet the illustrative KGE threshold.",
			),
		).toBeInTheDocument()
		// The evidence badge renders twice (compact on the card + full in the
		// detail pane) -- assert at least one real, correctly-titled instance.
		expect(screen.getAllByTitle(/run:run.01031500.calibration/).length).toBeGreaterThan(0)
	})

	it("shows the ledger load error when the gRPC call fails", async () => {
		getLedgerStateMock.mockRejectedValue(new Error("session not found"))

		renderBoard()

		expect(await screen.findByText(/Ledger load failed: session not found/)).toBeInTheDocument()
	})

	it("F-4: an 'experiment'-typed evidence span is clickable (unlike unnavigable source types)", async () => {
		const claimWithExperimentSpan = {
			...SUPPORTED_CLAIM,
			evidenceSpans: [
				{ sourceType: "experiment", sourceId: "panel_smoke_exp", metricRef: "", description: "" },
				{ sourceType: "paper", sourceId: "10.1234/example", metricRef: "", description: "" },
			],
		}
		getLedgerStateMock.mockResolvedValue({
			sessionId: "demo-reproducibility-cockpit",
			claims: [claimWithExperimentSpan],
			updatedAtMs: Date.now(),
		})

		renderBoard()
		await waitFor(() => expect(screen.getByText("1 claims")).toBeInTheDocument())

		// Renders twice each (compact badge on the card + full badge in the
		// auto-selected detail pane) -- assert every instance has the right
		// enabled/disabled state, not just one.
		const experimentBadges = screen.getAllByTitle(/experiment:panel_smoke_exp.*open experiment table/)
		const paperBadges = screen.getAllByTitle(/^paper:10\.1234\/example$/)
		expect(experimentBadges.length).toBeGreaterThan(0)
		expect(paperBadges.length).toBeGreaterThan(0)
		for (const badge of experimentBadges) {
			expect(badge).not.toBeDisabled()
		}
		for (const badge of paperBadges) {
			expect(badge).toBeDisabled()
		}
	})

	it("F-4: Check staleness posts a real agent-task prompt naming the session, then reflects the host's started/error response", async () => {
		platformPostMessageMock.mockClear()
		getLedgerStateMock.mockResolvedValue({
			sessionId: "demo-reproducibility-cockpit",
			claims: [SUPPORTED_CLAIM],
			updatedAtMs: Date.now(),
		})

		renderBoard()
		await waitFor(() => expect(screen.getByText("1 claims")).toBeInTheDocument())

		fireEvent.click(screen.getByText("Check staleness"))
		expect(screen.getByText("Starting…")).toBeInTheDocument()

		// Real prompt content, not a placeholder: names the actual session and
		// the actual MCP tool the agent is expected to call.
		const call = platformPostMessageMock.mock.calls.find(([msg]) => msg?.type === "aihydro-ledger-agent-task")
		expect(call).toBeDefined()
		const sentMessage = call?.[0] as { requestId: string; prompt: string }
		expect(sentMessage.prompt).toContain("check_registry_staleness")
		expect(sentMessage.prompt).toContain("demo-reproducibility-cockpit")

		// Simulate the host confirming the task started, using the REAL
		// requestId EvidenceBoard generated (not a stub) -- proves the
		// request/response round-trip actually correlates.
		fireEvent(
			window,
			new MessageEvent("message", {
				data: { type: "aihydro-ledger-agent-result", requestId: sentMessage.requestId, ok: true },
			}),
		)
		expect(await screen.findByText(/Agent task started/)).toBeInTheDocument()
	})

	it("F-4: Check staleness shows an error state when the host reports failure", async () => {
		platformPostMessageMock.mockClear()
		getLedgerStateMock.mockResolvedValue({
			sessionId: "demo-reproducibility-cockpit",
			claims: [SUPPORTED_CLAIM],
			updatedAtMs: Date.now(),
		})

		renderBoard()
		await waitFor(() => expect(screen.getByText("1 claims")).toBeInTheDocument())

		fireEvent.click(screen.getByText("Check staleness"))
		const call = platformPostMessageMock.mock.calls.find(([msg]) => msg?.type === "aihydro-ledger-agent-task")
		const sentMessage = call?.[0] as { requestId: string }

		fireEvent(
			window,
			new MessageEvent("message", {
				data: {
					type: "aihydro-ledger-agent-result",
					requestId: sentMessage.requestId,
					ok: false,
					error: "No main webview instance — cannot start an agent task",
				},
			}),
		)
		expect(await screen.findByText("No main webview instance — cannot start an agent task")).toBeInTheDocument()
	})
})
