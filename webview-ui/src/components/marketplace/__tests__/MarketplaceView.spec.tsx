import { render, screen } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"

import { MarketplaceView } from "../MarketplaceView"
import { MarketplaceViewStateManager } from "../MarketplaceViewStateManager"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
		getState: vi.fn(() => ({})),
		setState: vi.fn(),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("../useStateManager", () => ({
	useStateManager: () => [
		{
			allItems: [],
			displayItems: [],
			isFetching: false,
			activeTab: "mcp",
			filters: { type: "", search: "", tags: [] },
		},
		{
			transition: vi.fn(),
			onStateChange: vi.fn(() => vi.fn()),
		},
	],
}))

vi.mock("../MarketplaceListView", () => ({
	MarketplaceListView: ({ filterByType }: { filterByType: string }) => (
		<div data-testid="marketplace-list-view">MarketplaceListView - {filterByType}</div>
	),
}))

// Mock Tab components to avoid ExtensionStateContext dependency
vi.mock("@/components/common/Tab", () => ({
	Tab: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	TabHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	TabContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	TabList: ({ children, ...props }: any) => <div {...props}>{children}</div>,
	TabTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

describe("MarketplaceView", () => {
	const mockOnDone = vi.fn()
	const mockStateManager = new MarketplaceViewStateManager()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders without crashing", () => {
		render(<MarketplaceView stateManager={mockStateManager} onDone={mockOnDone} />)

		expect(screen.getByText("marketplace:title")).toBeInTheDocument()
		expect(screen.getByText("marketplace:done")).toBeInTheDocument()
	})

	it("calls onDone when Done button is clicked", async () => {
		const user = userEvent.setup()
		render(<MarketplaceView stateManager={mockStateManager} onDone={mockOnDone} />)

		await user.click(screen.getByText("marketplace:done"))
		expect(mockOnDone).toHaveBeenCalledTimes(1)
	})

	it("renders tab buttons", () => {
		render(<MarketplaceView stateManager={mockStateManager} onDone={mockOnDone} />)

		expect(screen.getByText("MCP")).toBeInTheDocument()
		expect(screen.getByText("Modes")).toBeInTheDocument()
	})

	it("renders MarketplaceListView", () => {
		render(<MarketplaceView stateManager={mockStateManager} onDone={mockOnDone} />)

		expect(screen.getByTestId("marketplace-list-view")).toBeInTheDocument()
	})
})
