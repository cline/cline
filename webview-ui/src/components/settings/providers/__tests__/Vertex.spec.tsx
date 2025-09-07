import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Vertex } from "../Vertex"
import type { ProviderSettings } from "@roo-code/types"
import { VERTEX_REGIONS } from "@roo-code/types"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, value, onInput, type }: any) => (
		<div>
			{children}
			<input type={type} value={value} onChange={(e) => onInput(e)} />
		</div>
	),
	VSCodeLink: ({ children, href }: any) => <a href={href}>{children}</a>,
}))

vi.mock("vscrui", () => ({
	Checkbox: ({ children, checked, onChange, "data-testid": testId }: any) => (
		<label data-testid={testId}>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
			{children}
		</label>
	),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/components/ui", () => ({
	Select: ({ children, value, onValueChange }: any) => (
		<div data-value={value} data-onvaluechange={onValueChange}>
			{children}
		</div>
	),
	SelectContent: ({ children }: any) => <div>{children}</div>,
	SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
	SelectTrigger: ({ children }: any) => <div>{children}</div>,
	SelectValue: ({ placeholder }: any) => <div>{placeholder}</div>,
}))

describe("Vertex", () => {
	const defaultApiConfiguration: ProviderSettings = {
		vertexKeyFile: "",
		vertexJsonCredentials: "",
		vertexProjectId: "",
		vertexRegion: "",
		enableUrlContext: false,
		enableGrounding: false,
		apiModelId: "gemini-2.0-flash-001",
	}

	const mockSetApiConfigurationField = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("VERTEX_REGIONS", () => {
		it('should include the "global" region as the first entry', () => {
			expect(VERTEX_REGIONS[0]).toEqual({ value: "global", label: "global" })
		})

		it('should contain "global" region exactly once', () => {
			const globalRegions = VERTEX_REGIONS.filter((r: { value: string; label: string }) => r.value === "global")
			expect(globalRegions).toHaveLength(1)
		})

		it('should contain all expected regions including "global"', () => {
			// The expected list is the imported VERTEX_REGIONS itself
			expect(VERTEX_REGIONS).toEqual([
				{ value: "global", label: "global" },
				{ value: "us-central1", label: "us-central1" },
				{ value: "us-east1", label: "us-east1" },
				{ value: "us-east4", label: "us-east4" },
				{ value: "us-east5", label: "us-east5" },
				{ value: "us-south1", label: "us-south1" },
				{ value: "us-west1", label: "us-west1" },
				{ value: "us-west2", label: "us-west2" },
				{ value: "us-west3", label: "us-west3" },
				{ value: "us-west4", label: "us-west4" },
				{ value: "northamerica-northeast1", label: "northamerica-northeast1" },
				{ value: "northamerica-northeast2", label: "northamerica-northeast2" },
				{ value: "southamerica-east1", label: "southamerica-east1" },
				{ value: "europe-west1", label: "europe-west1" },
				{ value: "europe-west2", label: "europe-west2" },
				{ value: "europe-west3", label: "europe-west3" },
				{ value: "europe-west4", label: "europe-west4" },
				{ value: "europe-west6", label: "europe-west6" },
				{ value: "europe-central2", label: "europe-central2" },
				{ value: "asia-east1", label: "asia-east1" },
				{ value: "asia-east2", label: "asia-east2" },
				{ value: "asia-northeast1", label: "asia-northeast1" },
				{ value: "asia-northeast2", label: "asia-northeast2" },
				{ value: "asia-northeast3", label: "asia-northeast3" },
				{ value: "asia-south1", label: "asia-south1" },
				{ value: "asia-south2", label: "asia-south2" },
				{ value: "asia-southeast1", label: "asia-southeast1" },
				{ value: "asia-southeast2", label: "asia-southeast2" },
				{ value: "australia-southeast1", label: "australia-southeast1" },
				{ value: "australia-southeast2", label: "australia-southeast2" },
				{ value: "me-west1", label: "me-west1" },
				{ value: "me-central1", label: "me-central1" },
				{ value: "africa-south1", label: "africa-south1" },
			])
		})

		it('should contain "asia-east1" region exactly once', () => {
			const asiaEast1Regions = VERTEX_REGIONS.filter(
				(r: { value: string; label: string }) => r.value === "asia-east1" && r.label === "asia-east1",
			)
			expect(asiaEast1Regions).toHaveLength(1)
			expect(asiaEast1Regions[0]).toEqual({ value: "asia-east1", label: "asia-east1" })
		})
	})

	describe("URL Context Checkbox", () => {
		it("should render URL context checkbox unchecked by default for Gemini models", () => {
			render(
				<Vertex
					apiConfiguration={defaultApiConfiguration}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const urlContextCheckbox = screen.getByTestId("checkbox-url-context")
			const checkbox = urlContextCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement
			expect(checkbox.checked).toBe(false)
		})

		it("should NOT render URL context checkbox for non-Gemini models", () => {
			const apiConfiguration = { ...defaultApiConfiguration, apiModelId: "claude-3-opus@20240229" }
			render(
				<Vertex apiConfiguration={apiConfiguration} setApiConfigurationField={mockSetApiConfigurationField} />,
			)

			const urlContextCheckbox = screen.queryByTestId("checkbox-url-context")
			expect(urlContextCheckbox).toBeNull()
		})

		it("should NOT render URL context checkbox when fromWelcomeView is true", () => {
			render(
				<Vertex
					apiConfiguration={defaultApiConfiguration}
					setApiConfigurationField={mockSetApiConfigurationField}
					fromWelcomeView={true}
				/>,
			)

			const urlContextCheckbox = screen.queryByTestId("checkbox-url-context")
			expect(urlContextCheckbox).toBeNull()
		})

		it("should render URL context checkbox checked when enableUrlContext is true for Gemini models", () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				enableUrlContext: true,
				apiModelId: "gemini-2.0-flash-001",
			}
			render(
				<Vertex apiConfiguration={apiConfiguration} setApiConfigurationField={mockSetApiConfigurationField} />,
			)

			const urlContextCheckbox = screen.getByTestId("checkbox-url-context")
			const checkbox = urlContextCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement
			expect(checkbox.checked).toBe(true)
		})

		it("should call setApiConfigurationField with correct parameters when URL context checkbox is toggled", async () => {
			const user = userEvent.setup()
			render(
				<Vertex
					apiConfiguration={defaultApiConfiguration}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const urlContextCheckbox = screen.getByTestId("checkbox-url-context")
			const checkbox = urlContextCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement

			await user.click(checkbox)

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("enableUrlContext", true)
		})
	})

	describe("Grounding with Google Search Checkbox", () => {
		it("should render grounding search checkbox unchecked by default for Gemini models", () => {
			render(
				<Vertex
					apiConfiguration={defaultApiConfiguration}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const groundingCheckbox = screen.getByTestId("checkbox-grounding-search")
			const checkbox = groundingCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement
			expect(checkbox.checked).toBe(false)
		})

		it("should NOT render grounding search checkbox for non-Gemini models", () => {
			const apiConfiguration = { ...defaultApiConfiguration, apiModelId: "claude-3-opus@20240229" }
			render(
				<Vertex apiConfiguration={apiConfiguration} setApiConfigurationField={mockSetApiConfigurationField} />,
			)

			const groundingCheckbox = screen.queryByTestId("checkbox-grounding-search")
			expect(groundingCheckbox).toBeNull()
		})

		it("should NOT render grounding search checkbox when fromWelcomeView is true", () => {
			render(
				<Vertex
					apiConfiguration={defaultApiConfiguration}
					setApiConfigurationField={mockSetApiConfigurationField}
					fromWelcomeView={true}
				/>,
			)

			const groundingCheckbox = screen.queryByTestId("checkbox-grounding-search")
			expect(groundingCheckbox).toBeNull()
		})

		it("should render grounding search checkbox checked when enableGrounding is true for Gemini models", () => {
			const apiConfiguration = {
				...defaultApiConfiguration,
				enableGrounding: true,
				apiModelId: "gemini-2.0-flash-001",
			}
			render(
				<Vertex apiConfiguration={apiConfiguration} setApiConfigurationField={mockSetApiConfigurationField} />,
			)

			const groundingCheckbox = screen.getByTestId("checkbox-grounding-search")
			const checkbox = groundingCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement
			expect(checkbox.checked).toBe(true)
		})

		it("should call setApiConfigurationField with correct parameters when grounding search checkbox is toggled", async () => {
			const user = userEvent.setup()
			render(
				<Vertex
					apiConfiguration={defaultApiConfiguration}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const groundingCheckbox = screen.getByTestId("checkbox-grounding-search")
			const checkbox = groundingCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement

			await user.click(checkbox)

			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("enableGrounding", true)
		})
	})

	describe("Both checkboxes interaction", () => {
		it("should be able to toggle both checkboxes independently", async () => {
			const user = userEvent.setup()
			render(
				<Vertex
					apiConfiguration={defaultApiConfiguration}
					setApiConfigurationField={mockSetApiConfigurationField}
				/>,
			)

			const urlContextCheckbox = screen.getByTestId("checkbox-url-context")
			const urlCheckbox = urlContextCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement

			const groundingCheckbox = screen.getByTestId("checkbox-grounding-search")
			const groundCheckbox = groundingCheckbox.querySelector("input[type='checkbox']") as HTMLInputElement

			// Toggle URL context
			await user.click(urlCheckbox)
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("enableUrlContext", true)

			// Toggle grounding
			await user.click(groundCheckbox)
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("enableGrounding", true)

			// Both should have been called
			expect(mockSetApiConfigurationField).toHaveBeenCalledTimes(2)
		})
	})
})
