import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useClinePassPromo } from "@/hooks/useClinePassPromo"
import { ClinePassCard, ClinePassWelcomeCallout } from "../ClinePassCard"

vi.mock("@/hooks/useClinePassPromo", async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual as Record<string, unknown>),
		useClinePassPromo: vi.fn(),
	}
})

const mockPromo = (overrides: Partial<ReturnType<typeof useClinePassPromo>> = {}) => {
	vi.mocked(useClinePassPromo).mockReturnValue({
		isClinePassEnabled: true,
		isUsingClinePass: false,
		subscribeUrl: "https://app.cline.bot/onboarding/individual-plan",
		manageSubscriptionUrl: "https://app.cline.bot/dashboard/subscription",
		openSubscribePage: vi.fn(),
		openManageSubscriptionPage: vi.fn(),
		selectClinePassProvider: vi.fn(),
		switchToClinePassProvider: vi.fn(),
		...overrides,
	})
}

describe("ClinePassCard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders nothing when ClinePass promotions are disabled", () => {
		mockPromo({ isClinePassEnabled: false })
		render(<ClinePassCard />)
		expect(screen.queryByTestId("cline-pass-card")).not.toBeInTheDocument()
	})

	it("promotes ClinePass when the user is not on the ClinePass provider", () => {
		mockPromo()
		render(<ClinePassCard />)
		expect(screen.getByText("Get ClinePass")).toBeInTheDocument()
		expect(screen.getByText("Use ClinePass Provider")).toBeInTheDocument()
		expect(screen.queryByText("Manage Subscription")).not.toBeInTheDocument()
	})

	it("switches to the ClinePass provider on click", () => {
		const switchToClinePassProvider = vi.fn().mockResolvedValue(undefined)
		mockPromo({ switchToClinePassProvider })
		render(<ClinePassCard />)
		fireEvent.click(screen.getByText("Use ClinePass Provider"))
		expect(switchToClinePassProvider).toHaveBeenCalledTimes(1)
	})

	it("links to subscription management when already using ClinePass", () => {
		mockPromo({ isUsingClinePass: true })
		render(<ClinePassCard />)
		expect(screen.getByText("Manage Subscription")).toBeInTheDocument()
		expect(screen.queryByText("Get ClinePass")).not.toBeInTheDocument()
	})
})

describe("ClinePassWelcomeCallout", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders nothing when ClinePass promotions are disabled", () => {
		mockPromo({ isClinePassEnabled: false })
		render(<ClinePassWelcomeCallout />)
		expect(screen.queryByTestId("cline-pass-welcome-callout")).not.toBeInTheDocument()
	})

	it("mentions ClinePass when promotions are enabled", () => {
		mockPromo()
		render(<ClinePassWelcomeCallout />)
		expect(screen.getByTestId("cline-pass-welcome-callout")).toHaveTextContent("ClinePass")
	})
})
