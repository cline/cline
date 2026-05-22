import { type HtmlPreviewItem, HtmlPreviewMode } from "@shared/proto/cline/html_preview"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { HtmlPreviewContextProvider, useHtmlPreviewContext } from "../HtmlPreviewContext"

// Helper to build a fully-typed HtmlPreviewItem for tests.
const mk = (id: string, title: string): HtmlPreviewItem => ({
	id,
	title,
	htmlContent: "",
	filePath: `/abs/${id}.html`,
	interactive: false,
	metadata: {},
	webviewUri: `https://example.vscode-cdn.net/file/abs/${id}.html?h=00000000`,
	dirUri: "https://example.vscode-cdn.net/file/abs",
	contentHash: "00000000deadbeef",
	resolvedMode: HtmlPreviewMode.SAFE,
})

const mkOp = (id: string, op: "clear" | "remove"): HtmlPreviewItem => ({
	id,
	title: "",
	htmlContent: "",
	filePath: "",
	interactive: false,
	metadata: { __operation: op },
	webviewUri: "",
	dirUri: "",
	contentHash: "",
	resolvedMode: HtmlPreviewMode.SAFE,
})

// Mock the gRPC client
const mockGetHtmlPreviewState = vi.fn()
const mockRemoveHtmlPreviewItem = vi.fn()
const mockSubscribeToHtmlPreviews = vi.fn()

vi.mock("../../services/grpc-client", () => ({
	HtmlPreviewServiceClient: {
		getHtmlPreviewState: (...args: any[]) => mockGetHtmlPreviewState(...args),
		removeHtmlPreviewItem: (...args: any[]) => mockRemoveHtmlPreviewItem(...args),
		subscribeToHtmlPreviews: (...args: any[]) => mockSubscribeToHtmlPreviews(...args),
	},
}))

// Stub useExtensionState — the context only reads `htmlPreviewVersion`.
vi.mock("../ExtensionStateContext", () => ({
	useExtensionState: () => ({ htmlPreviewVersion: 0 }),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Test component that consumes the context
const TestConsumer: React.FC = () => {
	const { items, activeItemId, removeItem, setActiveItemId } = useHtmlPreviewContext()

	return (
		<div>
			<div data-testid="item-count">{items.length}</div>
			<div data-testid="active-id">{activeItemId ?? "none"}</div>
			{items.map((item) => (
				<div data-testid={`item-${item.id}`} key={item.id}>
					{item.title}
				</div>
			))}
			<button data-testid="remove-btn" onClick={() => removeItem("html_1")}>
				Remove
			</button>
			<button data-testid="set-active-btn" onClick={() => setActiveItemId("html_1")}>
				Set Active
			</button>
		</div>
	)
}

describe("HtmlPreviewContext", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("provides initial empty state", async () => {
		mockGetHtmlPreviewState.mockResolvedValue({ items: [] })
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("0")
			expect(screen.getByTestId("active-id").textContent).to.equal("none")
		})
	})

	it("fetches and displays items from backend", async () => {
		const items: HtmlPreviewItem[] = [mk("html_1", "Preview 1"), mk("html_2", "Preview 2")]
		mockGetHtmlPreviewState.mockResolvedValue({ items })
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("2")
			expect(screen.getByTestId("item-html_1")).toBeInTheDocument()
			expect(screen.getByTestId("item-html_2")).toBeInTheDocument()
		})

		// Should auto-select the last item
		expect(screen.getByTestId("active-id").textContent).to.equal("html_2")
	})

	it("calls removeHtmlPreviewItem on backend when removeItem is invoked", async () => {
		mockGetHtmlPreviewState.mockResolvedValue({ items: [mk("html_1", "Preview 1")] })
		mockRemoveHtmlPreviewItem.mockResolvedValue({})
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-html_1")).toBeInTheDocument()
		})

		fireEvent.click(screen.getByTestId("remove-btn"))

		await waitFor(() => {
			expect(mockRemoveHtmlPreviewItem).toHaveBeenCalled()
		})
	})

	it("updates active item when setActiveItemId is called", async () => {
		mockGetHtmlPreviewState.mockResolvedValue({
			items: [mk("html_1", "Preview 1"), mk("html_2", "Preview 2")],
		})
		mockSubscribeToHtmlPreviews.mockReturnValue(() => {})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("active-id").textContent).to.equal("html_2")
		})

		// Click to change active from html_2 to html_1
		fireEvent.click(screen.getByTestId("set-active-btn"))

		await waitFor(() => {
			expect(screen.getByTestId("active-id").textContent).to.equal("html_1")
		})
	})

	it("handles clear operation from subscription", async () => {
		let onResponseHandler: ((item: HtmlPreviewItem) => void) | undefined

		mockGetHtmlPreviewState.mockResolvedValue({ items: [mk("html_1", "Preview 1")] })
		mockSubscribeToHtmlPreviews.mockImplementation((_req, handlers) => {
			onResponseHandler = handlers.onResponse
			return () => {}
		})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-html_1")).toBeInTheDocument()
		})

		if (onResponseHandler) {
			onResponseHandler(mkOp("__clear", "clear"))
		}

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("0")
			expect(screen.getByTestId("active-id").textContent).to.equal("none")
		})
	})

	it("handles remove operation from subscription", async () => {
		let onResponseHandler: ((item: HtmlPreviewItem) => void) | undefined

		mockGetHtmlPreviewState.mockResolvedValue({
			items: [mk("html_1", "Preview 1"), mk("html_2", "Preview 2")],
		})
		mockSubscribeToHtmlPreviews.mockImplementation((_req, handlers) => {
			onResponseHandler = handlers.onResponse
			return () => {}
		})

		render(
			<HtmlPreviewContextProvider>
				<TestConsumer />
			</HtmlPreviewContextProvider>,
		)

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("2")
		})

		if (onResponseHandler) {
			onResponseHandler(mkOp("html_1", "remove"))
		}

		await waitFor(() => {
			expect(screen.getByTestId("item-count").textContent).to.equal("1")
			expect(screen.queryByTestId("item-html_1")).not.toBeInTheDocument()
			expect(screen.getByTestId("item-html_2")).toBeInTheDocument()
		})
	})
})
