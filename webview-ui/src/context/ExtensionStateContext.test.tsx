import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "./ExtensionStateContext"

type StreamCallbacks<T> = {
	onResponse?: (value: T) => void
	onError?: (error: unknown) => void
	onComplete?: () => void
}

const subscriptions = {
	state: undefined as StreamCallbacks<{ stateJson?: string }> | undefined,
	partial: undefined as StreamCallbacks<any> | undefined,
	delta: undefined as StreamCallbacks<{ deltaJson?: string }> | undefined,
}

vi.mock("../services/grpc-client", () => ({
	StateServiceClient: {
		subscribeToState: (_request: unknown, callbacks: StreamCallbacks<{ stateJson?: string }>) => {
			subscriptions.state = callbacks
			return () => {
				subscriptions.state = undefined
			}
		},
		getLatestState: vi.fn().mockResolvedValue({
			stateJson: JSON.stringify({
				version: "resynced",
				clineMessages: [{ ts: 99, type: "say", say: "text", text: "resynced" }],
				currentTaskItem: { id: "task-1" },
			}),
		}),
		getAvailableTerminalProfiles: vi.fn().mockResolvedValue({ profiles: [] }),
	},
	UiServiceClient: {
		subscribeToMcpButtonClicked: vi.fn().mockReturnValue(() => {}),
		subscribeToHistoryButtonClicked: vi.fn().mockReturnValue(() => {}),
		subscribeToChatButtonClicked: vi.fn().mockReturnValue(() => {}),
		subscribeToAccountButtonClicked: vi.fn().mockReturnValue(() => {}),
		subscribeToSettingsButtonClicked: vi.fn().mockReturnValue(() => {}),
		subscribeToWorktreesButtonClicked: vi.fn().mockReturnValue(() => {}),
		subscribeToRelinquishControl: vi.fn().mockReturnValue(() => {}),
		subscribeToPartialMessage: (_request: unknown, callbacks: StreamCallbacks<any>) => {
			subscriptions.partial = callbacks
			return () => {
				subscriptions.partial = undefined
			}
		},
		subscribeToTaskUiDeltas: (_request: unknown, callbacks: StreamCallbacks<{ deltaJson?: string }>) => {
			subscriptions.delta = callbacks
			return () => {
				subscriptions.delta = undefined
			}
		},
		initializeWebview: vi.fn().mockResolvedValue({}),
	},
	McpServiceClient: {
		subscribeToMcpServers: vi.fn().mockReturnValue(() => {}),
		subscribeToMcpMarketplaceCatalog: vi.fn().mockReturnValue(() => {}),
	},
	ModelsServiceClient: {
		subscribeToOpenRouterModels: vi.fn().mockReturnValue(() => {}),
		subscribeToLiteLlmModels: vi.fn().mockReturnValue(() => {}),
		refreshOpenRouterModelsRpc: vi.fn().mockResolvedValue({ models: [] }),
		refreshVercelAiGatewayModelsRpc: vi.fn().mockResolvedValue({ models: [] }),
		refreshClineModelsRpc: vi.fn().mockResolvedValue({ models: [] }),
		refreshBasetenModelsRpc: vi.fn().mockResolvedValue({ models: [] }),
		refreshLiteLlmModelsRpc: vi.fn().mockResolvedValue({ models: [] }),
		refreshHicapModels: vi.fn().mockResolvedValue({ models: [] }),
	},
	FileServiceClient: {},
}))

function ContextProbe() {
	const state = useExtensionState() as any
	return (
		<>
			<div data-testid="version">{state.version}</div>
			<div data-testid="message-count">{state.clineMessages.length}</div>
			<div data-testid="latest-message">{state.clineMessages.at(-1)?.text ?? ""}</div>
			<div data-testid="background-command">{String(state.backgroundCommandRunning)}</div>
		</>
	)
}

describe("ExtensionStateContextProvider", () => {
	it("hydrates from full state and applies streaming task UI deltas", async () => {
		render(
			<ExtensionStateContextProvider>
				<ContextProbe />
			</ExtensionStateContextProvider>,
		)

		subscriptions.state?.onResponse?.({
			stateJson: JSON.stringify({
				version: "initial",
				clineMessages: [],
				currentTaskItem: { id: "task-1" },
				backgroundCommandRunning: false,
			}),
		})

		await waitFor(() => {
			expect(screen.getByTestId("version").textContent).toBe("initial")
		})

		subscriptions.delta?.onResponse?.({
			deltaJson: JSON.stringify({
				type: "message_added",
				taskId: "task-1",
				sequence: 1,
				message: { ts: 1, type: "say", say: "text", text: "hello" },
			}),
		})

		await waitFor(() => {
			expect(screen.getByTestId("message-count").textContent).toBe("1")
			expect(screen.getByTestId("latest-message").textContent).toBe("hello")
		})

		subscriptions.delta?.onResponse?.({
			deltaJson: JSON.stringify({
				type: "message_updated",
				taskId: "task-1",
				sequence: 2,
				message: { ts: 1, type: "say", say: "text", text: "hello world" },
			}),
		})
		subscriptions.delta?.onResponse?.({
			deltaJson: JSON.stringify({
				type: "task_metadata_updated",
				taskId: "task-1",
				sequence: 3,
				metadata: { backgroundCommandRunning: true, backgroundCommandTaskId: "task-1" },
			}),
		})

		await waitFor(() => {
			expect(screen.getByTestId("latest-message").textContent).toBe("hello world")
			expect(screen.getByTestId("background-command").textContent).toBe("true")
		})
	})
})
