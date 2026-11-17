import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import McpPlanModeNotice from "./McpPlanModeNotice"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ mcpServers: [], setMcpServers: vi.fn() }),
}))

vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: { setPlanModeAccess: vi.fn() },
}))

const call = { type: "use_mcp_tool", serverName: "ide", toolName: "run" } as const

describe("McpPlanModeNotice", () => {
	it("says why Plan mode asks and offers to allow the tool or its server", () => {
		render(<McpPlanModeNotice useMcpServer={{ ...call, planMode: "ask" }} />)

		expect(screen.getByTestId("plan-mode-ask")).toHaveTextContent("the server does not mark this tool read-only")
		expect(screen.getByTestId("plan-mode-access-tool")).toHaveTextContent("Always allow in Plan mode")
		expect(screen.getByTestId("plan-mode-access-server")).toHaveTextContent("Always allow all tools from ide in Plan mode")
	})

	it("offers no override for a tool the server no longer lists, as its names are a guess", () => {
		render(<McpPlanModeNotice useMcpServer={{ ...call, planMode: "ask_unlisted" }} />)

		expect(screen.getByTestId("plan-mode-ask-unlisted")).toHaveTextContent("the server no longer lists this tool")
		expect(screen.queryByTestId("plan-mode-access-tool")).toBeNull()
		expect(screen.queryByTestId("plan-mode-access-server")).toBeNull()
	})

	it("says why a read-only tool ran without asking", () => {
		render(<McpPlanModeNotice useMcpServer={{ ...call, planMode: "read_only" }} />)

		expect(screen.getByTestId("plan-mode-read-only-note")).toHaveTextContent("the server marks this tool read-only")
		expect(screen.queryByTestId("plan-mode-access-tool")).toBeNull()
	})

	it("shows nothing for a call Plan mode did not change", () => {
		const { container } = render(<McpPlanModeNotice useMcpServer={call} />)

		expect(container).toBeEmptyDOMElement()
	})
})
