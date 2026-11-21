import type { McpServer } from "@shared/mcp"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ServerRow from "./ServerRow"

const state = vi.hoisted(() => ({ planModeMcpLimitsEnabled: true }))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalSettings: { actions: { useMcp: false } },
		mcpServers: [],
		setMcpServers: vi.fn(),
		remoteConfigSettings: undefined,
		planModeMcpLimitsEnabled: state.planModeMcpLimitsEnabled,
	}),
}))

vi.mock("@/services/grpc-client", () => ({ McpServiceClient: {} }))

function renderExpanded(server: Partial<McpServer>) {
	render(<ServerRow server={{ name: "docs", config: "{}", status: "connected", ...server }} />)
	fireEvent.click(screen.getByText("docs"))
}

describe("ServerRow server-wide Plan-mode override", () => {
	const readOnlyTools = [{ name: "search", annotations: { readOnlyHint: true } }]

	beforeEach(() => {
		state.planModeMcpLimitsEnabled = true
	})

	it("offers no Plan-mode override, for the server or its tools, while the limits are not turned on", () => {
		state.planModeMcpLimitsEnabled = false
		renderExpanded({ tools: [...readOnlyTools, { name: "fetch" }], allowAllInPlanMode: true })

		expect(screen.queryByTestId("plan-mode-access-server")).toBeNull()
		expect(screen.queryByTestId("plan-mode-access-tool")).toBeNull()
	})

	it("is offered when Plan mode limits one of the server's tools", () => {
		renderExpanded({ tools: [...readOnlyTools, { name: "fetch" }] })

		expect(screen.getByTestId("plan-mode-access-server")).toBeInTheDocument()
	})

	it("is not offered when every tool is declared read-only", () => {
		renderExpanded({ tools: readOnlyTools })

		expect(screen.queryByTestId("plan-mode-access-server")).toBeNull()
	})

	it("stays, so it can be taken back, while a saved override covers a server whose tools are now all read-only", () => {
		renderExpanded({ tools: readOnlyTools, allowAllInPlanMode: true })

		expect(screen.getByTestId("plan-mode-access-server")).toBeInTheDocument()
	})
})
