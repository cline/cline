// npx vitest run src/components/marketplace/__tests__/MarketplaceListView.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"

import { TooltipProvider } from "@/components/ui/tooltip"
import { ExtensionStateContextProvider } from "@/context/ExtensionStateContext"

import { MarketplaceListView } from "../MarketplaceListView"
import { ViewState } from "../MarketplaceViewStateManager"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

const mockTransition = vi.fn()
const mockState: ViewState = {
	allItems: [],
	organizationMcps: [],
	displayItems: [],
	displayOrganizationMcps: [],
	isFetching: false,
	activeTab: "mcp",
	filters: {
		type: "",
		search: "",
		tags: [],
		installed: "all",
	},
}

vi.mock("../useStateManager", () => ({
	useStateManager: () => [mockState, { transition: mockTransition }],
}))

const defaultProps = {
	stateManager: {} as any,
	allTags: ["tag1", "tag2"],
	filteredTags: ["tag1", "tag2"],
}

describe("MarketplaceListView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockState.filters.tags = []
		mockState.isFetching = false
		mockState.displayItems = []
	})

	const renderWithProviders = (props = {}) =>
		render(
			<ExtensionStateContextProvider>
				<TooltipProvider delayDuration={300}>
					<MarketplaceListView {...defaultProps} {...props} />
				</TooltipProvider>
			</ExtensionStateContextProvider>,
		)

	it("renders search input", () => {
		renderWithProviders()

		const searchInput = screen.getByPlaceholderText("marketplace:filters.search.placeholder")
		expect(searchInput).toBeInTheDocument()
	})

	it("does not render type filter (removed in simplified interface)", () => {
		renderWithProviders()

		expect(screen.queryByText("marketplace:filters.type.label")).not.toBeInTheDocument()
		expect(screen.queryByText("marketplace:filters.type.all")).not.toBeInTheDocument()
	})

	it("does not render sort options (removed in simplified interface)", () => {
		renderWithProviders()

		expect(screen.queryByText("marketplace:filters.sort.label")).not.toBeInTheDocument()
		expect(screen.queryByText("marketplace:filters.sort.name")).not.toBeInTheDocument()
	})

	it("renders tags section when tags are available", () => {
		renderWithProviders()

		expect(screen.getByText("marketplace:filters.tags.label")).toBeInTheDocument()
	})

	it("shows loading state when fetching", () => {
		mockState.isFetching = true

		renderWithProviders()

		expect(screen.getByText("marketplace:items.refresh.refreshing")).toBeInTheDocument()
		expect(screen.getByText("marketplace:items.refresh.mayTakeMoment")).toBeInTheDocument()
	})

	it("shows empty state when no items and not fetching", () => {
		renderWithProviders()

		expect(screen.getByText("marketplace:items.empty.noItems")).toBeInTheDocument()
		expect(screen.getByText("marketplace:items.empty.adjustFilters")).toBeInTheDocument()
	})

	it("updates search filter when typing", () => {
		renderWithProviders()

		const searchInput = screen.getByPlaceholderText("marketplace:filters.search.placeholder")
		fireEvent.change(searchInput, { target: { value: "test" } })

		expect(mockTransition).toHaveBeenCalledWith({
			type: "UPDATE_FILTERS",
			payload: { filters: { search: "test" } },
		})
	})

	it("shows clear tags button when tags are selected", async () => {
		const user = userEvent.setup()
		mockState.filters.tags = ["tag1"]

		renderWithProviders()

		const clearButton = screen.getByText("marketplace:filters.tags.clear")
		expect(clearButton).toBeInTheDocument()

		await user.click(clearButton)
		expect(mockTransition).toHaveBeenCalledWith({
			type: "UPDATE_FILTERS",
			payload: { filters: { tags: [] } },
		})
	})
})
