import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import McpConfigurationView from "./McpConfigurationView"

const mocks = vi.hoisted(() => ({
	getLatestMcpServers: vi.fn(),
	setMcpServers: vi.fn(),
	remoteConfigSettings: {} as Record<string, unknown>,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		remoteConfigSettings: mocks.remoteConfigSettings,
		setMcpServers: mocks.setMcpServers,
		environment: "production",
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: {
		getLatestMcpServers: mocks.getLatestMcpServers,
	},
}))

vi.mock("@shared/proto-conversions/mcp/mcp-服务器-conversion", () => ({
	convertProtoMcpServersToMcpServers: () => [],
}))

vi.mock("./tabs/add-server/AddRemoteServerForm", () => ({
	default: () => <div>Add Remote Server Form</div>,
}))

vi.mock("./tabs/installed/ConfigureServersView", () => ({
	default: () => <div>Configure Servers View</div>,
}))

describe("McpConfigurationView", () => {
	beforeEach(() => {
		mocks.getLatestMcpServers.mockResolvedValue({ mcpServers: [] })
		mocks.setMcpServers.mockReset()
		mocks.getLatestMcpServers.mockClear()
		mocks.remoteConfigSettings = {}
	})

	it("never renders the marketplace tab while keeping remote servers available", async () => {
		mocks.remoteConfigSettings = {
			block个人RemoteMCPServers: false,
		}

		render(<McpConfigurationView onDone={vi.fn()} />)

		expect(screen.queryByRole("button", { name: "Marketplace" })).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Remote Servers" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Configure" })).toBeInTheDocument()
		expect(screen.getByText("Configure Servers View")).toBeInTheDocument()

		await waitFor(() => expect(mocks.getLatestMcpServers).toHaveBeenCalledTimes(1))
	})

	it("hides remote servers only when personal remote MCP servers are blocked", () => {
		mocks.remoteConfigSettings = {
			block个人RemoteMCPServers: true,
		}

		render(<McpConfigurationView initialTab="addRemote" onDone={vi.fn()} />)

		expect(screen.queryByRole("button", { name: "Marketplace" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Remote Servers" })).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Configure" })).toBeInTheDocument()
		expect(screen.queryByText("Add Remote Server Form")).not.toBeInTheDocument()
		expect(screen.getByText("Configure Servers View")).toBeInTheDocument()
	})
})
