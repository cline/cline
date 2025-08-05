// npx vitest src/components/settings/__tests__/ThinkingBudget.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"

import type { ModelInfo } from "@roo-code/types"

import { ThinkingBudget } from "../ThinkingBudget"

vi.mock("@/components/ui", () => ({
	Slider: ({ value, onValueChange, min, max, step }: any) => (
		<input
			type="range"
			data-testid="slider"
			min={min}
			max={max}
			step={step}
			value={value[0]}
			onChange={(e) => onValueChange([parseInt(e.target.value)])}
		/>
	),
}))

vi.mock("@/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: (apiConfiguration: any) => {
		// Return the model ID based on apiConfiguration for testing
		// For Gemini tests, check if apiProvider is gemini and use apiModelId
		if (apiConfiguration?.apiProvider === "gemini") {
			return {
				id: apiConfiguration?.apiModelId || "gemini-2.0-flash-exp",
				provider: "gemini",
				info: undefined,
			}
		}
		return {
			id: apiConfiguration?.apiModelId || "claude-3-5-sonnet-20241022",
			provider: apiConfiguration?.apiProvider || "anthropic",
			info: undefined,
		}
	},
}))

describe("ThinkingBudget", () => {
	const mockModelInfo: ModelInfo = {
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
		maxTokens: 16384,
		contextWindow: 200000,
		supportsPromptCache: true,
		supportsImages: true,
	}

	const defaultProps = {
		apiConfiguration: {},
		setApiConfigurationField: vi.fn(),
		modelInfo: mockModelInfo,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should render nothing when model doesn't support thinking", () => {
		const { container } = render(
			<ThinkingBudget
				{...defaultProps}
				modelInfo={{
					...mockModelInfo,
					maxTokens: 16384,
					contextWindow: 200000,
					supportsPromptCache: true,
					supportsImages: true,
					supportsReasoningBudget: false,
				}}
			/>,
		)

		expect(container.firstChild).toBeNull()
	})

	it("should render sliders when model supports thinking", () => {
		render(<ThinkingBudget {...defaultProps} />)

		expect(screen.getAllByTestId("slider")).toHaveLength(2)
	})

	it("should update modelMaxThinkingTokens", () => {
		const setApiConfigurationField = vi.fn()

		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{ modelMaxThinkingTokens: 4096 }}
				setApiConfigurationField={setApiConfigurationField}
			/>,
		)

		const sliders = screen.getAllByTestId("slider")
		fireEvent.change(sliders[1], { target: { value: "5000" } })

		expect(setApiConfigurationField).toHaveBeenCalledWith("modelMaxThinkingTokens", 5000)
	})

	it("should cap thinking tokens at 80% of max tokens", () => {
		const setApiConfigurationField = vi.fn()

		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{ modelMaxTokens: 10000, modelMaxThinkingTokens: 9000 }}
				setApiConfigurationField={setApiConfigurationField}
			/>,
		)

		// Effect should trigger and cap the value
		expect(setApiConfigurationField).toHaveBeenCalledWith("modelMaxThinkingTokens", 8000) // 80% of 10000
	})

	it("should use default thinking tokens if not provided", () => {
		render(<ThinkingBudget {...defaultProps} apiConfiguration={{ modelMaxTokens: 10000 }} />)

		// Default is 80% of max tokens, capped at 8192
		const sliders = screen.getAllByTestId("slider")
		expect(sliders[1]).toHaveValue("8000") // 80% of 10000
	})

	it("should use min thinking tokens of 1024 for non-Gemini models", () => {
		render(<ThinkingBudget {...defaultProps} apiConfiguration={{ modelMaxTokens: 1000 }} />)

		const sliders = screen.getAllByTestId("slider")
		expect(sliders[1].getAttribute("min")).toBe("1024")
	})

	it("should use min thinking tokens of 128 for Gemini 2.5 Pro models", () => {
		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{
					modelMaxTokens: 10000,
					apiProvider: "gemini",
					apiModelId: "gemini-2.5-pro-002",
				}}
			/>,
		)

		const sliders = screen.getAllByTestId("slider")
		expect(sliders[1].getAttribute("min")).toBe("128")
	})

	it("should use step of 128 for Gemini 2.5 Pro models", () => {
		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{
					modelMaxTokens: 10000,
					apiProvider: "gemini",
					apiModelId: "gemini-2.5-pro-002",
				}}
			/>,
		)

		const sliders = screen.getAllByTestId("slider")
		expect(sliders[1].getAttribute("step")).toBe("128")
	})

	it("should use step of 1024 for non-Gemini models", () => {
		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{
					modelMaxTokens: 10000,
					apiProvider: "anthropic",
					apiModelId: "claude-3-5-sonnet-20241022",
				}}
			/>,
		)

		const sliders = screen.getAllByTestId("slider")
		expect(sliders[1].getAttribute("step")).toBe("1024")
	})

	it("should update max tokens when slider changes", () => {
		const setApiConfigurationField = vi.fn()

		render(
			<ThinkingBudget
				{...defaultProps}
				apiConfiguration={{ modelMaxTokens: 10000 }}
				setApiConfigurationField={setApiConfigurationField}
			/>,
		)

		const sliders = screen.getAllByTestId("slider")
		fireEvent.change(sliders[0], { target: { value: "12000" } })

		expect(setApiConfigurationField).toHaveBeenCalledWith("modelMaxTokens", 12000)
	})
})
