import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { UiServiceClient } from "@/services/grpc-client"
import { ToolResultDisclosure } from "./ToolResultDisclosure"

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		getToolResult: vi.fn(),
	},
}))

vi.mock("../common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <pre>{source}</pre>,
}))

describe("ToolResultDisclosure", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("hides the full result by default and loads it only after expansion", async () => {
		vi.mocked(UiServiceClient.getToolResult).mockResolvedValue({
			id: "result-1",
			toolName: "run_commands",
			content: "full retained output",
			isError: false,
			truncated: false,
			createdAt: 1,
		})
		render(
			<ToolResultDisclosure
				message={{
					ts: 1,
					type: "say",
					say: "command",
					toolResultId: "result-1",
					toolResultPreview: "short preview",
				}}
			/>,
		)

		expect(screen.queryByText(/full retained output/)).not.toBeInTheDocument()
		expect(UiServiceClient.getToolResult).not.toHaveBeenCalled()

		await userEvent.click(screen.getByRole("button", { name: "View full result" }))

		await waitFor(() => expect(screen.getByText(/full retained output/)).toBeInTheDocument())
		expect(UiServiceClient.getToolResult).toHaveBeenCalledOnce()
	})

	it("keeps an error preview visible while the normal result is collapsed", () => {
		render(
			<ToolResultDisclosure
				message={{
					ts: 1,
					type: "say",
					say: "tool",
					toolResultId: "result-2",
					toolResultPreview: "permission denied",
					toolResultIsError: true,
				}}
			/>,
		)

		expect(screen.getByText("permission denied")).toBeInTheDocument()
		expect(UiServiceClient.getToolResult).not.toHaveBeenCalled()
	})
})
