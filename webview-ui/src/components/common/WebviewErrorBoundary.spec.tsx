import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import WebviewErrorBoundary from "./WebviewErrorBoundary"

const ThrowingComponent = () => {
	throw new Error("boom")
}

describe("WebviewErrorBoundary", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("renders children when no error is thrown", () => {
		render(
			<WebviewErrorBoundary>
				<div>Healthy child</div>
			</WebviewErrorBoundary>,
		)

		expect(screen.getByText("Healthy child")).toBeTruthy()
	})

	it("renders a recovery UI when a child throws", () => {
		render(
			<WebviewErrorBoundary>
				<ThrowingComponent />
			</WebviewErrorBoundary>,
		)

		expect(screen.getByText("Cline webview crashed")).toBeTruthy()
		expect(screen.getByRole("button", { name: "Reload webview" })).toBeTruthy()
	})
})
