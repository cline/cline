import { render, screen } from "@testing-library/react"
import ApiOptions from "../ApiOptions"
import { ExtensionStateContextProvider } from "../../../context/ExtensionStateContext"

// Mock VSCode components
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, value, onBlur }: any) => (
		<div>
			{children}
			<input type="text" value={value} onChange={onBlur} />
		</div>
	),
	VSCodeLink: ({ children, href }: any) => <a href={href}>{children}</a>,
	VSCodeRadio: ({ children, value, checked }: any) => <input type="radio" value={value} checked={checked} />,
	VSCodeRadioGroup: ({ children }: any) => <div>{children}</div>,
}))

// Mock other components
jest.mock("vscrui", () => ({
	Dropdown: ({ children, value, onChange }: any) => (
		<select value={value} onChange={onChange}>
			{children}
		</select>
	),
	Checkbox: ({ children, checked, onChange }: any) => (
		<label>
			<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
			{children}
		</label>
	),
	Pane: ({ children }: any) => <div>{children}</div>,
}))

jest.mock("../TemperatureControl", () => ({
	TemperatureControl: ({ value, onChange }: any) => (
		<div data-testid="temperature-control">
			<input
				type="range"
				value={value || 0}
				onChange={(e) => onChange(parseFloat(e.target.value))}
				min={0}
				max={2}
				step={0.1}
			/>
		</div>
	),
}))

describe("ApiOptions", () => {
	const renderApiOptions = (props = {}) => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions {...props} />
			</ExtensionStateContextProvider>,
		)
	}

	it("shows temperature control by default", () => {
		renderApiOptions()
		expect(screen.getByTestId("temperature-control")).toBeInTheDocument()
	})

	it("hides temperature control when fromWelcomeView is true", () => {
		renderApiOptions({ fromWelcomeView: true })
		expect(screen.queryByTestId("temperature-control")).not.toBeInTheDocument()
	})
})
