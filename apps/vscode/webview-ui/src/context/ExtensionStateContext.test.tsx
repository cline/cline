import type { ExtensionState } from "@shared/ExtensionMessage"
import { act, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "./ExtensionStateContext"

const stream = vi.hoisted(() => ({ onResponse: undefined as undefined | ((value: { stateJson: string }) => void) }))
vi.mock("../services/grpc-client", () => {
	const client = new Proxy(
		{},
		{
			get: (_target, method: string) =>
				method.startsWith("subscribe")
					? (_request: unknown, callbacks: { onResponse: typeof stream.onResponse }) => {
							if (method === "subscribeToState") stream.onResponse = callbacks.onResponse
							return () => undefined
						}
					: async () => ({}),
		},
	)
	return { StateServiceClient: client, UiServiceClient: client, McpServiceClient: client, ModelsServiceClient: client }
})

it("does not restore a report from a delayed state packet after auth clear or session replacement", async () => {
	let latest: ExtensionState
	function Probe() {
		latest = useExtensionState()
		return <span>{latest.subscriptionUsage?.windows[0]?.usedPercent ?? "none"}</span>
	}
	render(
		<ExtensionStateContextProvider>
			<Probe />
		</ExtensionStateContextProvider>,
	)
	const report: ExtensionState["subscriptionUsage"] = {
		providerId: "openai-codex",
		source: "codex-response-headers",
		capturedAt: 1800000000000,
		windows: [{ id: "primary", usedPercent: 25 }],
	}
	const send = async (epoch: number, stateVersion: number, subscriptionUsage?: ExtensionState["subscriptionUsage"]) => {
		await act(async () =>
			stream.onResponse?.({ stateJson: JSON.stringify({ ...latest, epoch, stateVersion, subscriptionUsage }) }),
		)
	}
	await send(1, 2, report)
	expect(screen.getByText("25")).toBeInTheDocument()
	await send(1, 3, null)
	await send(1, 2, report)
	expect(screen.getByText("none")).toBeInTheDocument()
	await send(2, 1)
	await send(1, 4, report)
	expect(screen.getByText("none")).toBeInTheDocument()
})
