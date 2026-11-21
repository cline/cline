import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"
import { DeleteOpenAICompatibleProvider } from "./DeleteOpenAICompatibleProvider"

const remove = vi.hoisted(() => vi.fn())
vi.mock("@/services/grpc-client", () => ({ ModelsServiceClient: { deleteOpenAiCompatibleProvider: remove } }))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ appearance: _, ...props }: ComponentProps<"button"> & { appearance?: string }) => <button {...props} />,
}))

describe("delete compatible provider", () => {
	it("requires confirmation, permits cancellation and refreshes after deletion", async () => {
		remove.mockResolvedValue({})
		const onDeleted = vi.fn().mockResolvedValue(undefined)
		render(<DeleteOpenAICompatibleProvider name="test3" onDeleted={onDeleted} providerId="custom-openai-test3" />)
		fireEvent.click(screen.getByText("Delete custom provider"))
		expect(screen.getByText(/Delete “test3”/)).toBeInTheDocument()
		expect(remove).not.toHaveBeenCalled()
		fireEvent.click(screen.getByText("Cancel"))
		fireEvent.click(screen.getByText("Delete custom provider"))
		fireEvent.click(screen.getByText("Delete provider"))
		await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
		expect(remove).toHaveBeenCalledWith({ value: "custom-openai-test3" })
	})
})
