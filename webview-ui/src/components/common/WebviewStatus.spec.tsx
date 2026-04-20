import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import WebviewStatus from "./WebviewStatus"

describe("WebviewStatus", () => {
	it("renders a loading state", () => {
		render(
			<WebviewStatus
				description="Waiting for state"
				isLoading
				onReload={vi.fn()}
				onRetry={vi.fn()}
				title="Loading Cline"
			/>,
		)

		expect(screen.getByText("Loading Cline")).toBeTruthy()
		expect(screen.getByText("Waiting for state")).toBeTruthy()
		expect(screen.getByRole("button", { name: "Retry connection" })).toBeTruthy()
		expect(screen.getByRole("button", { name: "Reload webview" })).toBeTruthy()
	})

	it("shows details and invokes retry", () => {
		const onRetry = vi.fn()

		render(
			<WebviewStatus
				description="Retry it"
				details="Timed out waiting for initial state"
				onRetry={onRetry}
				title="Cline is having trouble loading"
			/>,
		)

		expect(screen.getByText("Timed out waiting for initial state")).toBeTruthy()
		fireEvent.click(screen.getByRole("button", { name: "Retry connection" }))
		expect(onRetry).toHaveBeenCalledTimes(1)
	})
})
