import { act, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "./ExtensionStateContext"

const stateSubscription = {
	callbacks: undefined as { onResponse?: (response: { stateJson?: string }) => void } | undefined,
}

const makeUnsubscribe = () => vi.fn()

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		subscribeToState: vi.fn((_request, callbacks) => {
			stateSubscription.callbacks = callbacks
			return makeUnsubscribe()
		}),
		getAvailableTerminalProfiles: vi.fn(async () => ({ profiles: [] })),
	},
	UiServiceClient: {
		subscribeToMcpButtonClicked: vi.fn(() => makeUnsubscribe()),
		subscribeToHistoryButtonClicked: vi.fn(() => makeUnsubscribe()),
		subscribeToChatButtonClicked: vi.fn(() => makeUnsubscribe()),
		subscribeToSettingsButtonClicked: vi.fn(() => makeUnsubscribe()),
		subscribeToWorktreesButtonClicked: vi.fn(() => makeUnsubscribe()),
		subscribeToPartialMessage: vi.fn(() => makeUnsubscribe()),
		subscribeToAccountButtonClicked: vi.fn(() => makeUnsubscribe()),
		subscribeToRelinquishControl: vi.fn(() => makeUnsubscribe()),
		initializeWebview: vi.fn(async () => undefined),
	},
	McpServiceClient: {
		subscribeToMcpServers: vi.fn(() => makeUnsubscribe()),
		subscribeToMcpMarketplaceCatalog: vi.fn(() => makeUnsubscribe()),
	},
	ModelsServiceClient: {
		subscribeToOpenRouterModels: vi.fn(() => makeUnsubscribe()),
		subscribeToLiteLlmModels: vi.fn(() => makeUnsubscribe()),
		refreshOpenRouterModelsRpc: vi.fn(async () => ({ models: [] })),
		refreshVercelAiGatewayModelsRpc: vi.fn(async () => ({ models: [] })),
		refreshBasetenModelsRpc: vi.fn(async () => ({ models: [] })),
		refreshLiteLlmModelsRpc: vi.fn(async () => ({ models: [] })),
		refreshClineModelsRpc: vi.fn(async () => ({ models: [] })),
		refreshHicapModels: vi.fn(async () => ({ models: [] })),
	},
}))

function StateProbe() {
	const state = useExtensionState() as ReturnType<typeof useExtensionState> & { clineMessages: Array<{ text?: string }> }
	const { didHydrateState, clineMessages } = state
	return (
		<>
			<div data-testid="hydrated">{String(didHydrateState)}</div>
			<div data-testid="count">{clineMessages.length}</div>
			<div data-testid="last-text">{clineMessages.at(-1)?.text ?? ""}</div>
		</>
	)
}

describe("ExtensionStateContextProvider", () => {
	it("hydrates repeated large stateJson payloads from the state subscription", async () => {
		const largeText = "x".repeat(256 * 1024)
		const firstState = {
			version: "1.0.0",
			mode: "act",
			clineMessages: Array.from({ length: 12 }, (_, i) => ({
				ts: i + 1,
				type: "say",
				say: "text",
				text: `first-${i}-${largeText}`,
			})),
			taskHistory: [],
		} as any
		const secondState = {
			...firstState,
			clineMessages: [...firstState.clineMessages, { ts: 99, type: "say", say: "text", text: `second-tail-${largeText}` }],
		} as any

		render(
			<ExtensionStateContextProvider>
				<StateProbe />
			</ExtensionStateContextProvider>,
		)

		await waitFor(() => expect(stateSubscription.callbacks?.onResponse).toBeTypeOf("function"))

		act(() => {
			stateSubscription.callbacks?.onResponse?.({ stateJson: JSON.stringify(firstState) })
		})

		await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"))
		expect(screen.getByTestId("count").textContent).toBe("12")
		expect(screen.getByTestId("last-text").textContent).toContain("first-11-")

		act(() => {
			stateSubscription.callbacks?.onResponse?.({ stateJson: JSON.stringify(secondState) })
		})

		await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("13"))
		expect(screen.getByTestId("last-text").textContent).toContain("second-tail-")
	})
})
