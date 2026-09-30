import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ChatGptPlanProvider } from "./ChatGptPlanProvider"

const state = vi.hoisted(() => ({
	connected: false,
	read: vi.fn(),
	commitSelection: vi.fn(),
	signIn: vi.fn(),
	signOut: vi.fn(),
}))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => ({ apiConfiguration: {} }) }))
vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: () => ({
		config: { hasAccessToken: state.connected },
		read: state.read,
		commitSelection: state.commitSelection,
	}),
}))
vi.mock("@/hooks/useStaticProviderSelection", () => ({
	useStaticProviderSelection: () => ({
		models: {
			"plan-model": { name: "Account model", supportsPromptCache: false },
			"second-model": { name: "Another model", supportsPromptCache: false },
		},
		selectedModelId: "plan-model",
	}),
}))
vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: { chatGptPlanSignIn: state.signIn, chatGptPlanSignOut: state.signOut },
}))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: (props: ComponentProps<"button">) => <button {...props} />,
	VSCodeDropdown: (props: ComponentProps<"select">) => <select {...props} />,
	VSCodeOption: (props: ComponentProps<"option">) => <option {...props} />,
}))

beforeEach(() => {
	vi.resetAllMocks()
	state.connected = false
})

describe("ChatGPT plan settings", () => {
	it("starts opt-in sign-in and waits for the host's verified connection state", async () => {
		let finish!: () => void
		state.signIn.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve
				}),
		)
		render(<ChatGptPlanProvider currentMode="act" showModelOptions />)
		expect(screen.queryByLabelText("Model")).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }))
		expect(screen.getByRole("button", { name: "Waiting for browser…" })).toBeDisabled()
		expect(state.signIn).toHaveBeenCalledWith({})
		finish()
		await waitFor(() => expect(state.read).toHaveBeenCalledOnce())
		expect(screen.queryByLabelText("Model")).not.toBeInTheDocument()
	})

	it("keeps inference unavailable when authorization fails", async () => {
		state.signIn.mockRejectedValue(new Error("ChatGPT plan usage was not granted"))
		render(<ChatGptPlanProvider currentMode="act" showModelOptions />)
		fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }))
		expect(await screen.findByRole("alert")).toHaveTextContent("ChatGPT plan usage was not granted")
		expect(screen.queryByLabelText("Model")).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Continue with ChatGPT" })).toBeEnabled()
	})

	it("shows account model names, saves model slugs, and supports local sign-out", async () => {
		state.connected = true
		render(<ChatGptPlanProvider currentMode="plan" showModelOptions />)
		expect(screen.getByRole("option", { name: "Account model" })).toHaveValue("plan-model")
		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "second-model" } })
		expect(state.commitSelection).toHaveBeenCalledWith("plan", { providerId: "openai-chatgpt", modelId: "second-model" })
		fireEvent.click(screen.getByRole("button", { name: "Sign out locally" }))
		await waitFor(() => expect(state.signOut).toHaveBeenCalledWith({}))
		await waitFor(() => expect(state.read).toHaveBeenCalledOnce())
	})
})
