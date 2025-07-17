import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import ErrorRow from "./ErrorRow"
import { ClineMessage } from "@shared/ExtensionMessage"

// Mock the auth context
vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => ({
		handleSignIn: vi.fn(),
		clineUser: null,
	}),
}))

describe("ErrorRow", () => {
	const mockMessage: ClineMessage = {
		ts: 123456789,
		type: "say",
		say: "error",
		text: "Test error message",
	}

	it("renders basic error message", () => {
		render(<ErrorRow message={mockMessage} errorType="error" />)

		expect(screen.getByText("Error")).toBeInTheDocument()
		expect(screen.getByText("Test error message")).toBeInTheDocument()
	})

	it("renders mistake limit reached error", () => {
		const mistakeMessage = { ...mockMessage, text: "Mistake limit reached" }
		render(<ErrorRow message={mistakeMessage} errorType="mistake_limit_reached" />)

		expect(screen.getByText("Cline is having trouble...")).toBeInTheDocument()
		expect(screen.getByText("Mistake limit reached")).toBeInTheDocument()
	})

	it("renders auto approval max requests error", () => {
		const maxReqMessage = { ...mockMessage, text: "Max requests reached" }
		render(<ErrorRow message={maxReqMessage} errorType="auto_approval_max_req_reached" />)

		expect(screen.getByText("Maximum Requests Reached")).toBeInTheDocument()
		expect(screen.getByText("Max requests reached")).toBeInTheDocument()
	})

	it("renders diff error", () => {
		render(<ErrorRow message={mockMessage} errorType="diff_error" />)

		expect(screen.getByText("Diff Edit Mismatch")).toBeInTheDocument()
		expect(
			screen.getByText("The model used search patterns that don't match anything in the file. Retrying..."),
		).toBeInTheDocument()
	})

	it("renders clineignore error", () => {
		const clineignoreMessage = { ...mockMessage, text: "/path/to/file.txt" }
		render(<ErrorRow message={clineignoreMessage} errorType="clineignore_error" />)

		expect(screen.getByText("Access Denied")).toBeInTheDocument()
		expect(screen.getByText(/Cline tried to access/)).toBeInTheDocument()
		expect(screen.getByText("/path/to/file.txt")).toBeInTheDocument()
	})
})
