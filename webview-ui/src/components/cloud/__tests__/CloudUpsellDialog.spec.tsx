import { render, screen, fireEvent } from "@testing-library/react"
import { vi } from "vitest"
import { CloudUpsellDialog } from "../CloudUpsellDialog"

// Mock the useTranslation hook
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"cloud:cloudBenefitsTitle": "Connect to Roo Cloud",
				"cloud:cloudBenefitSharing": "Share tasks with your team",
				"cloud:cloudBenefitHistory": "Access conversation history",
				"cloud:cloudBenefitMetrics": "View usage metrics",
				"cloud:cloudBenefitWalkaway": "Walk away with your code",
				"cloud:connect": "Connect to Cloud",
			}
			return translations[key] || key
		},
	}),
}))

describe("CloudUpsellDialog", () => {
	const mockOnOpenChange = vi.fn()
	const mockOnConnect = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders dialog when open", () => {
		render(<CloudUpsellDialog open={true} onOpenChange={mockOnOpenChange} onConnect={mockOnConnect} />)

		expect(screen.getByText("Connect to Roo Cloud")).toBeInTheDocument()
		expect(screen.getByText("Share tasks with your team")).toBeInTheDocument()
		expect(screen.getByText("Access conversation history")).toBeInTheDocument()
		expect(screen.getByText("View usage metrics")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Connect to Cloud" })).toBeInTheDocument()
	})

	it("does not render dialog when closed", () => {
		render(<CloudUpsellDialog open={false} onOpenChange={mockOnOpenChange} onConnect={mockOnConnect} />)

		expect(screen.queryByText("Connect to Roo Cloud")).not.toBeInTheDocument()
	})

	it("calls onConnect when connect button is clicked", () => {
		render(<CloudUpsellDialog open={true} onOpenChange={mockOnOpenChange} onConnect={mockOnConnect} />)

		const connectButton = screen.getByRole("button", { name: "Connect to Cloud" })
		fireEvent.click(connectButton)

		expect(mockOnConnect).toHaveBeenCalledTimes(1)
	})

	it("renders all three benefits as list items", () => {
		render(<CloudUpsellDialog open={true} onOpenChange={mockOnOpenChange} onConnect={mockOnConnect} />)

		const listItems = screen.getAllByRole("listitem")
		expect(listItems).toHaveLength(4)
	})
})
