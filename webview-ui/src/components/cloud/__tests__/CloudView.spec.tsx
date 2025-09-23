import { render, screen } from "@/utils/test-utils"

import { CloudView } from "../CloudView"

// Mock the translation context
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"cloud:title": "Cloud",
				"settings:common.done": "Done",
				"cloud:signIn": "Connect to Roo Code Cloud",
				"cloud:cloudBenefitsTitle": "Connect to Roo Code Cloud",
				"cloud:cloudBenefitSharing": "Share tasks with others",
				"cloud:cloudBenefitHistory": "Access your task history",
				"cloud:cloudBenefitMetrics": "Get a holistic view of your token consumption",
				"cloud:logOut": "Log out",
				"cloud:connect": "Connect Now",
				"cloud:visitCloudWebsite": "Visit Roo Code Cloud",
				"cloud:taskSync": "Task sync",
				"cloud:taskSyncDescription": "Sync your tasks for viewing and sharing on Roo Code Cloud",
				"cloud:taskSyncManagedByOrganization": "Task sync is managed by your organization",
				"cloud:remoteControl": "Roomote Control",
				"cloud:remoteControlDescription":
					"Enable following and interacting with tasks in this workspace with Roo Code Cloud",
				"cloud:remoteControlRequiresTaskSync": "Task sync must be enabled to use Roomote Control",
				"cloud:usageMetricsAlwaysReported": "Model usage info is always reported when logged in",
				"cloud:profilePicture": "Profile picture",
				"cloud:cloudUrlPillLabel": "Roo Code Cloud URL: ",
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
const mockExtensionState = {
	remoteControlEnabled: false,
	setRemoteControlEnabled: vi.fn(),
	taskSyncEnabled: true,
	setTaskSyncEnabled: vi.fn(),
	featureRoomoteControlEnabled: true, // Default to true for tests
	setFeatureRoomoteControlEnabled: vi.fn(),
}

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

// Mock window global for images
Object.defineProperty(window, "IMAGES_BASE_URI", {
	value: "/images",
	writable: true,
})

describe("CloudView", () => {
	it("should display benefits when user is not authenticated", () => {
		render(
			<CloudView
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
			<CloudView
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

	it("should display remote control toggle when user has extension bridge enabled and roomote control enabled", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
			extensionBridgeEnabled: true,
		}

		render(
			<CloudView
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
			<CloudView
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

	it("should not display remote control toggle when roomote control is disabled", () => {
		// Temporarily override the mock for this specific test
		const originalFeatureRoomoteControlEnabled = mockExtensionState.featureRoomoteControlEnabled
		mockExtensionState.featureRoomoteControlEnabled = false

		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
			extensionBridgeEnabled: true, // Bridge enabled but roomote control disabled
		}

		render(
			<CloudView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the remote control toggle is NOT displayed
		expect(screen.queryByTestId("remote-control-toggle")).not.toBeInTheDocument()
		expect(screen.queryByText("Roomote Control")).not.toBeInTheDocument()

		// Restore the original value
		mockExtensionState.featureRoomoteControlEnabled = originalFeatureRoomoteControlEnabled
	})

	it("should display remote control toggle for organization users (simulating backend logic)", () => {
		// This test simulates what the ClineProvider would do:
		// Organization users are treated as having featureRoomoteControlEnabled true
		const originalFeatureRoomoteControlEnabled = mockExtensionState.featureRoomoteControlEnabled
		mockExtensionState.featureRoomoteControlEnabled = true // Simulating ClineProvider logic for org users

		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
			organizationId: "org-123", // User is in an organization
			extensionBridgeEnabled: true,
		}

		render(
			<CloudView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the remote control toggle IS displayed for organization users
		// (The ClineProvider would set featureRoomoteControlEnabled to true for org users)
		expect(screen.getByTestId("remote-control-toggle")).toBeInTheDocument()
		expect(screen.getByText("Roomote Control")).toBeInTheDocument()

		// Restore the original value
		mockExtensionState.featureRoomoteControlEnabled = originalFeatureRoomoteControlEnabled
	})

	it("should not display cloud URL pill when pointing to production", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
		}

		render(
			<CloudView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the cloud URL pill is NOT displayed for production URL
		expect(screen.queryByText(/Roo Code Cloud URL:/)).not.toBeInTheDocument()
	})

	it("should display cloud URL pill when pointing to non-production environment", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
		}

		render(
			<CloudView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://staging.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the cloud URL pill is displayed with the staging URL
		expect(screen.getByText(/Roo Code Cloud URL:/)).toBeInTheDocument()
		expect(screen.getByText("https://staging.roocode.com")).toBeInTheDocument()
	})

	it("should display cloud URL pill for non-authenticated users when not pointing to production", () => {
		render(
			<CloudView
				userInfo={null}
				isAuthenticated={false}
				cloudApiUrl="https://dev.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the cloud URL pill is displayed even when not authenticated
		expect(screen.getByText(/Roo Code Cloud URL:/)).toBeInTheDocument()
		expect(screen.getByText("https://dev.roocode.com")).toBeInTheDocument()
	})

	it("should not display cloud URL pill when cloudApiUrl is undefined", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
		}

		render(<CloudView userInfo={mockUserInfo} isAuthenticated={true} onDone={() => {}} />)

		// Check that the cloud URL pill is NOT displayed when cloudApiUrl is undefined
		expect(screen.queryByText(/Roo Code Cloud URL:/)).not.toBeInTheDocument()
	})

	it("should disable task sync toggle for organization users", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
			organizationId: "org-123",
			organizationName: "Test Organization",
		}

		render(
			<CloudView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the task sync toggle is disabled for organization users
		const taskSyncToggle = screen.getByTestId("task-sync-toggle")
		expect(taskSyncToggle).toBeInTheDocument()
		expect(taskSyncToggle).toHaveAttribute("tabindex", "-1")

		// Check that the lock icon is displayed (indicating organization control)
		const lockIcon = screen.getByTestId("task-sync-toggle").parentElement?.querySelector(".lucide-lock")
		expect(lockIcon).toBeInTheDocument()

		// Check that the tooltip trigger is present (which contains the organization message)
		const tooltipTrigger = screen
			.getByTestId("task-sync-toggle")
			.parentElement?.querySelector('[data-slot="tooltip-trigger"]')
		expect(tooltipTrigger).toBeInTheDocument()
	})

	it("should enable task sync toggle for non-organization users", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
			// No organizationId - regular user
		}

		render(
			<CloudView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the task sync toggle is enabled for non-organization users
		const taskSyncToggle = screen.getByTestId("task-sync-toggle")
		expect(taskSyncToggle).toBeInTheDocument()
		expect(taskSyncToggle).toHaveAttribute("tabindex", "0")

		// Check that the organization message is NOT displayed
		expect(screen.queryByText("Task sync is managed by your organization")).not.toBeInTheDocument()
	})

	it("should show task sync state correctly for organization users", () => {
		const mockUserInfo = {
			name: "Test User",
			email: "test@example.com",
			organizationId: "org-123",
			organizationName: "Test Organization",
		}

		// Test with task sync enabled
		render(
			<CloudView
				userInfo={mockUserInfo}
				isAuthenticated={true}
				cloudApiUrl="https://app.roocode.com"
				onDone={() => {}}
			/>,
		)

		// Check that the toggle shows the current state (enabled in this case)
		const taskSyncToggle = screen.getByTestId("task-sync-toggle")
		expect(taskSyncToggle).toHaveAttribute("aria-checked", "true")
		expect(taskSyncToggle).toHaveAttribute("tabindex", "-1")
	})
})
