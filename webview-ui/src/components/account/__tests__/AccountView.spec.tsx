import { render, screen } from "@/utils/test-utils"
import { describe, it, expect, vi } from "vitest"
import { AccountView } from "../AccountView"

// Mock the translation context
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"account:title": "Account",
				"settings:common.done": "Done",
				"account:signIn": "Connect to Roo Code Cloud",
				"account:cloudBenefitsTitle": "Connect to Roo Code Cloud",
				"account:cloudBenefitSharing": "Share tasks with others",
				"account:cloudBenefitHistory": "Access your task history",
				"account:cloudBenefitMetrics": "Get a holistic view of your token consumption",
				"account:logOut": "Log out",
				"account:connect": "Connect Now",
				"account:visitCloudWebsite": "Visit Roo Code Cloud",
				"account:remoteControl": "Roomote Control",
				"account:remoteControlDescription":
					"Enable following and interacting with tasks in this workspace with Roo Code Cloud",
				"account:profilePicture": "Profile picture",
			}
			return translations[key] || key
		},
	}),
}))

// Mock vscode utilities
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock telemetry client
vi.mock("@src/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
	},
}))

// Mock the extension state context
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		remoteControlEnabled: false,
		setRemoteControlEnabled: vi.fn(),
	}),
}))

// Mock window global for images
Object.defineProperty(window, "IMAGES_BASE_URI", {
	value: "/images",
	writable: true,
})

describe("AccountView", () => {
	it("should display benefits when user is not authenticated", () => {
		render(
			<AccountView
				userInfo={null}
				isAuthenticated={false}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the benefits section is displayed
		expect(screen.getByRole("heading", { name: "Connect to Roo Code Cloud" })).toBeInTheDocument()
		expect(screen.getByText("Share tasks with others")).toBeInTheDocument()
		expect(screen.getByText("Access your task history")).toBeInTheDocument()
		expect(screen.getByText("Get a holistic view of your token consumption")).toBeInTheDocument()

		// Check that the connect button is also present
		expect(screen.getByText("Connect Now")).toBeInTheDocument()
	})

	it("should not display benefits when user is authenticated", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
		}

		render(
			<AccountView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the benefits section is NOT displayed
		expect(
			screen.queryByText("Follow and control tasks from anywhere with Roomote Control"),
		).not.toBeInTheDocument()
		expect(screen.queryByText("Share tasks with others")).not.toBeInTheDocument()
		expect(screen.queryByText("Access your task history")).not.toBeInTheDocument()
		expect(screen.queryByText("Get a holistic view of your token consumption")).not.toBeInTheDocument()

		// Check that user info is displayed instead
		expect(screen.getByText("Test User")).toBeInTheDocument()
		expect(screen.getByText("test@example.com")).toBeInTheDocument()
	})

	it("should display remote control toggle when user has extension bridge enabled", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
			extensionBridgeEnabled: true,
		}

		render(
			<AccountView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the remote control toggle is displayed
		expect(screen.getByTestId("remote-control-toggle")).toBeInTheDocument()
		expect(screen.getByText("Roomote Control")).toBeInTheDocument()
		expect(
			screen.getByText("Enable following and interacting with tasks in this workspace with Roo Code Cloud"),
		).toBeInTheDocument()
	})

	it("should not display remote control toggle when user does not have extension bridge enabled", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
			extensionBridgeEnabled: false,
		}

		render(
			<AccountView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the remote control toggle is NOT displayed
		expect(screen.queryByTestId("remote-control-toggle")).not.toBeInTheDocument()
		expect(screen.queryByText("Roomote Control")).not.toBeInTheDocument()
	})
})
