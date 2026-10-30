import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import McpToolRow from "./McpToolRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalSettings: { actions: { useMcp: false } },
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
