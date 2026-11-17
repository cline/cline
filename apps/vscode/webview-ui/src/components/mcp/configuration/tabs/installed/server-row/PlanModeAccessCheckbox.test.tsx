import type { McpServer } from "@shared/mcp"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type ReactNode, useLayoutEffect } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PlanModeAccessCheckbox from "./PlanModeAccessCheckbox"

const mocks = vi.hoisted(() => ({
	servers: [] as McpServer[],
	setMcpServers: vi.fn(),
	setPlanModeAccess: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ mcpServers: mocks.servers, setMcpServers: mocks.setMcpServers }),
}))

vi.mock("@/services/grpc-client", () => ({
	McpServiceClient: { setPlanModeAccess: mocks.setPlanModeAccess },
}))

// Like the toolkit checkbox, this one also reports a change when its `checked`
// prop is set, not only when the user clicks it.
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: (props: {
		children?: ReactNode
		checked?: boolean
		disabled?: boolean
		onChange?: (event: { target: { checked: boolean } }) => void
	}) => {
		useLayoutEffect(() => {
			props.onChange?.({ target: { checked: props.checked === true } })
		}, [props.checked])
		return (
			<label>
				<input
					checked={props.checked}
					disabled={props.disabled}
					onChange={(event) => props.onChange?.(event)}
					type="checkbox"
				/>
				{props.children}
			</label>
		)
	},
}))

function ide(overrides: Partial<McpServer> = {}): McpServer {
	return { name: "ide", config: "{}", status: "connected", tools: [{ name: "run" }, { name: "rename" }], ...overrides }
}

describe("PlanModeAccessCheckbox", () => {
	beforeEach(() => {
		mocks.servers = [ide()]
		mocks.setMcpServers.mockReset()
		mocks.setPlanModeAccess.mockReset().mockResolvedValue({ mcpServers: [] })
	})

	it("allows one tool and shows the servers the host sends back", async () => {
		render(
			<PlanModeAccessCheckbox serverName="ide" toolName="run">
				Allow
			</PlanModeAccessCheckbox>,
		)
		expect(screen.getByRole("checkbox")).not.toBeChecked()

		fireEvent.click(screen.getByRole("checkbox"))

		expect(mocks.setPlanModeAccess).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ serverName: "ide", toolNames: ["run"], allowed: true, wholeServer: false }),
		)
		await waitFor(() => expect(mocks.setMcpServers).toHaveBeenCalledExactlyOnceWith([]))
	})

	it("takes back a tool that is allowed", async () => {
		mocks.servers = [ide({ tools: [{ name: "run", allowInPlanMode: true }] })]
		render(
			<PlanModeAccessCheckbox serverName="ide" toolName="run">
				Allow
			</PlanModeAccessCheckbox>,
		)
		expect(screen.getByRole("checkbox")).toBeChecked()

		fireEvent.click(screen.getByRole("checkbox"))

		expect(mocks.setPlanModeAccess).toHaveBeenCalledWith(
			expect.objectContaining({ toolNames: ["run"], allowed: false, wholeServer: false }),
		)
		await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled())
	})

	it("allows the whole server when no tool is named", async () => {
		render(<PlanModeAccessCheckbox serverName="ide">Allow all</PlanModeAccessCheckbox>)
		expect(screen.getByRole("checkbox")).not.toBeChecked()

		fireEvent.click(screen.getByRole("checkbox"))

		expect(mocks.setPlanModeAccess).toHaveBeenCalledWith(
			expect.objectContaining({ serverName: "ide", toolNames: [], allowed: true, wholeServer: true }),
		)
		await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled())
	})

	it("is locked until a save is answered, so a second click cannot be lost", async () => {
		let answer: (response: { mcpServers: [] }) => void = () => {}
		mocks.setPlanModeAccess.mockReturnValue(new Promise((resolve) => (answer = resolve)))
		render(
			<PlanModeAccessCheckbox serverName="ide" toolName="run">
				Allow
			</PlanModeAccessCheckbox>,
		)

		fireEvent.click(screen.getByRole("checkbox"))
		expect(screen.getByRole("checkbox")).toBeDisabled()

		answer({ mcpServers: [] })
		await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled())
		expect(mocks.setPlanModeAccess).toHaveBeenCalledOnce()
	})

	it("is unlocked again when a save fails", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		mocks.setPlanModeAccess.mockRejectedValue(new Error("not in the settings file"))
		render(<PlanModeAccessCheckbox serverName="ide">Allow all</PlanModeAccessCheckbox>)

		fireEvent.click(screen.getByRole("checkbox"))

		await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled())
	})

	it("saves nothing when the saved value changes under it", () => {
		const view = (
			<PlanModeAccessCheckbox serverName="ide" toolName="run">
				Tool
			</PlanModeAccessCheckbox>
		)
		const { rerender } = render(view)

		// The whole server gets allowed elsewhere, which checks this tool too.
		mocks.servers = [ide({ allowAllInPlanMode: true })]
		rerender(view)
		mocks.servers = [ide()]
		rerender(view)

		expect(mocks.setPlanModeAccess).not.toHaveBeenCalled()
	})

	it("shows a tool as allowed, and fixed, while the whole server is allowed", () => {
		mocks.servers = [ide({ allowAllInPlanMode: true })]
		render(
			<>
				<PlanModeAccessCheckbox serverName="ide" toolName="run">
					Tool
				</PlanModeAccessCheckbox>
				<PlanModeAccessCheckbox serverName="ide">Server</PlanModeAccessCheckbox>
			</>,
		)

		expect(screen.getByLabelText("Tool")).toBeChecked()
		expect(screen.getByLabelText("Tool")).toBeDisabled()
		expect(screen.getByLabelText("Server")).toBeChecked()
		expect(screen.getByLabelText("Server")).toBeEnabled()
	})
})
