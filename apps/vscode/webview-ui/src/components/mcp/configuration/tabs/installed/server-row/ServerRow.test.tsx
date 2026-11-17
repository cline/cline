import type { McpServer } from "@shared/mcp"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ServerRow from "./ServerRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalSettings: { actions: { useMcp: false } },
		mcpServers: [],
		setMcpServers: vi.fn(),
		remoteConfigSettings: undefined,
	}),
}))

vi.mock("@/services/grpc-client", () => ({ McpServiceClient: {} }))

function renderExpanded(server: Partial<McpServer>) {
	render(<ServerRow server={{ name: "docs", config: "{}", status: "connected", ...server }} />)
	fireEvent.click(screen.getByText("docs"))
}

describe("ServerRow server-wide Plan-mode override", () => {
	const readOnlyTools = [{ name: "search", annotations: { readOnlyHint: true } }]

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
