import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import McpToolRow from "./McpToolRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalSettings: { actions: { useMcp: false } },
		mcpServers: [],
		setMcpServers: vi.fn(),
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: { toggleToolAutoApprove: vi.fn() },
}))

describe("McpToolRow hint badge", () => {
	it("labels a tool the server declares read-only", () => {
		render(<McpToolRow serverName="jetbrains" tool={{ name: "get_file_text", annotations: { readOnlyHint: true } }} />)
		expect(screen.getByTestId("tool-hint-badge")).toHaveTextContent("read-only")
	})

	it("shows no badge for a tool the server declares as modifying", () => {
		render(<McpToolRow serverName="jetbrains" tool={{ name: "rename_refactoring", annotations: { readOnlyHint: false } }} />)
		expect(screen.queryByTestId("tool-hint-badge")).toBeNull()
	})

	it("shows no badge when the server declares nothing", () => {
		render(<McpToolRow serverName="blender" tool={{ name: "execute_blender_code" }} />)
		expect(screen.queryByTestId("tool-hint-badge")).toBeNull()
	})
})

describe("McpToolRow Plan-mode override", () => {
	const renderRow = (annotations: { readOnlyHint?: boolean } | undefined, showPlanModeAccess = true) =>
		render(<McpToolRow serverName="jetbrains" showPlanModeAccess={showPlanModeAccess} tool={{ name: "tool", annotations }} />)

	it("is offered for a tool the server declares as modifying or does not declare", () => {
		renderRow({ readOnlyHint: false })
		renderRow(undefined)
		expect(screen.getAllByTestId("plan-mode-access-tool")).toHaveLength(2)
	})

	it("is not offered for a declared read-only tool, which Plan mode already allows", () => {
		renderRow({ readOnlyHint: true })
		expect(screen.queryByTestId("plan-mode-access-tool")).toBeNull()
	})

	it("is not offered where the row is shown without the server's hints", () => {
		renderRow(undefined, false)
		expect(screen.queryByTestId("plan-mode-access-tool")).toBeNull()
	})
})
