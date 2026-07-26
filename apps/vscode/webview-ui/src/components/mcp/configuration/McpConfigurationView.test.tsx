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
	})

	it("renders configured and remote server entry points", async () => {
		render(<McpConfigurationView onDone={vi.fn()} />)

		expect(screen.getByRole("button", { name: "Remote Servers" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Configure" })).toBeInTheDocument()
		expect(screen.getByText("Configure Servers View")).toBeInTheDocument()

		await waitFor(() => expect(mocks.getLatestMcpServers).toHaveBeenCalledTimes(1))
	})

	it("keeps user-configured remote servers available", () => {
		render(<McpConfigurationView initialTab="addRemote" onDone={vi.fn()} />)

		expect(screen.getByRole("button", { name: "Remote Servers" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Configure" })).toBeInTheDocument()
		expect(screen.getByText("Add Remote Server Form")).toBeInTheDocument()
	})
})
