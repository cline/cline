import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("lucide-react", () => {
	const Icon = () => null
	return {
		CheckCheck: Icon,
		FlaskConical: Icon,
		HardDriveDownload: Icon,
		Info: Icon,
		SlidersHorizontal: Icon,
		SquareMousePointer: Icon,
		SquareTerminal: Icon,
		Wrench: Icon,
	}
})

vi.mock("react-use", () => ({
	useEvent: vi.fn(),
}))

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: React.ReactNode }) => children,
	TooltipContent: ({ children }: { children: React.ReactNode }) => children,
	TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => ({ activeOrganization: null }),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		version: "test",
		environment: "local",
		settingsInitialModelTab: undefined,
	}),
}))

vi.mock("@/lib/utils", () => ({
	cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		resetState: vi.fn(),
	},
}))

vi.mock("../account/helpers", () => ({
	isAdminOrOwner: () => false,
}))

vi.mock("../common/Tab", () => ({
	Tab: ({ children }: { children: React.ReactNode }) => children,
	TabContent: ({ children }: { children: React.ReactNode }) => children,
	TabList: ({ children }: { children: React.ReactNode }) => children,
	TabTrigger: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock("../common/ViewHeader", () => ({
	default: () => null,
}))

vi.mock("./SectionHeader", () => ({
	default: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock("./sections/AboutSection", () => ({ default: () => null }))
vi.mock("./sections/ApiConfigurationSection", () => ({ default: () => null }))
vi.mock("./sections/BrowserSettingsSection", () => ({ default: () => null }))
vi.mock("./sections/DebugSection", () => ({ default: () => null }))
vi.mock("./sections/FeatureSettingsSection", () => ({ default: () => null }))
vi.mock("./sections/GeneralSettingsSection", () => ({ default: () => null }))
vi.mock("./sections/RemoteConfigSection", () => ({ RemoteConfigSection: () => null }))
vi.mock("./sections/TerminalSettingsSection", () => ({ default: () => null }))

describe("SETTINGS_TABS debug visibility", () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.resetModules()
	})

	it("hides the debug tab outside dev mode", async () => {
		vi.stubEnv("IS_DEV", "")

		const { SETTINGS_TABS } = await import("./SettingsView")
		const debugTab = SETTINGS_TABS.find((tab) => tab.id === "debug")

		expect(debugTab).toBeDefined()
		expect(debugTab?.hidden?.({ activeOrganization: null })).toBe(true)
	})

	it("shows the debug tab in dev mode", async () => {
		vi.stubEnv("IS_DEV", '"true"')

		const { SETTINGS_TABS } = await import("./SettingsView")
		const debugTab = SETTINGS_TABS.find((tab) => tab.id === "debug")

		expect(debugTab).toBeDefined()
		expect(debugTab?.hidden?.({ activeOrganization: null })).toBe(false)
	})
})
