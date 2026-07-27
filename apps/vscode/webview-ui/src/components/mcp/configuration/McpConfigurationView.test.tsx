import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import McpConfigurationView from "./McpConfigurationView"

const mocks = vi.hoisted(() => ({
	getLatestMcpServers: vi.fn(),
	setMcpServers: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		setMcpServers: mocks.setMcpServers,
		environment: "production",
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: {
		getLatestMcpServers: mocks.getLatestMcpServers,
	},
}))

vi.mock("@shared/proto-conversions/mcp/mcp-server-conversion", () => ({
	convertProtoMcpServersToMcpServers: () => [],
}))

vi.mock("./tabs/installed/ConfigureServersView", () => ({
	default: () => <div>Configure Servers View</div>,
}))

describe("McpConfigurationView", () => {
	beforeEach(() => {
		mocks.getLatestMcpServers.mockResolvedValue({ mcpServers: [] })
		mocks.setMcpServers.mockReset()
		mocks.getLatestMcpServers.mockClear()
	})

	it("renders local MCP configuration with the corporate-safe boundary", async () => {
		render(<McpConfigurationView onDone={vi.fn()} />)

		expect(screen.getByText("Configure Servers View")).toBeInTheDocument()
		expect(screen.getByText(/only explicitly configured local stdio MCP servers/i)).toBeInTheDocument()
		expect(screen.queryByText(/Add Remote Server/i)).not.toBeInTheDocument()

		await waitFor(() => expect(mocks.getLatestMcpServers).toHaveBeenCalledTimes(1))
	})
})
