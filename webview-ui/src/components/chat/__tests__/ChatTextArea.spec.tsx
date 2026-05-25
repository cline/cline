import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { describe, expect, it, vi } from "vitest"

const mockTogglePlanActModeProto = vi.fn().mockResolvedValue({ value: false })

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: (props: React.ComponentProps<"button">) => <button {...props} />,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mode: "plan",
		apiConfiguration: undefined,
		openRouterModels: {},
		platform: "macos",
		localWorkflowToggles: [],
		globalWorkflowToggles: [],
		remoteWorkflowToggles: [],
		remoteConfigSettings: undefined,
		navigateToSettingsModelPicker: vi.fn(),
		mcpServers: [],
	}),
}))

vi.mock("@/context/PlatformContext", () => ({
	usePlatform: () => ({
		togglePlanActKeys: "Tab",
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		searchCommits: vi.fn().mockResolvedValue({ commits: [] }),
		searchFiles: vi.fn().mockResolvedValue({ files: [] }),
		getRelativePaths: vi.fn().mockResolvedValue({ paths: [] }),
	},
	StateServiceClient: {
		togglePlanActModeProto: (...args: unknown[]) => mockTogglePlanActModeProto(...args),
	},
}))

vi.mock("@/utils/hooks", () => ({
	useMetaKeyDetection: () => [false, "Cmd"],
	useShortcut: vi.fn(),
}))

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("../ContextMenu", () => ({
	default: () => null,
}))

vi.mock("../SlashCommandMenu", () => ({
	default: () => null,
}))

vi.mock("@/components/common/Thumbnails", () => ({
	default: () => null,
}))

vi.mock("../ServersToggleModal", () => ({
	default: () => null,
}))

vi.mock("../../cline-rules/ClineRulesToggleModal", () => ({
	default: () => null,
}))

import ChatTextArea from "../ChatTextArea"

describe("ChatTextArea mode switch", () => {
	it("renders the plan/act picker as an accessible radio group", () => {
		render(
			<ChatTextArea
				inputValue=""
				onSelectFilesAndImages={vi.fn()}
				onSend={vi.fn()}
				placeholderText="Ask Cline"
				selectedFiles={[]}
				selectedImages={[]}
				sendingDisabled={false}
				setInputValue={vi.fn()}
				setSelectedFiles={vi.fn()}
				setSelectedImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		expect(screen.getByRole("radiogroup", { name: "Plan or Act mode" })).toBeTruthy()
		expect(screen.getByRole("radio", { name: "Plan" }).getAttribute("aria-checked")).toBe("true")
		expect(screen.getByRole("radio", { name: "Act" }).getAttribute("aria-checked")).toBe("false")
	})

	it("selects act mode when the act radio is clicked", () => {
		render(
			<ChatTextArea
				inputValue=""
				onSelectFilesAndImages={vi.fn()}
				onSend={vi.fn()}
				placeholderText="Ask Cline"
				selectedFiles={[]}
				selectedImages={[]}
				sendingDisabled={false}
				setInputValue={vi.fn()}
				setSelectedFiles={vi.fn()}
				setSelectedImages={vi.fn()}
				shouldDisableFilesAndImages={false}
			/>,
		)

		fireEvent.click(screen.getByRole("radio", { name: "Act" }))

		expect(mockTogglePlanActModeProto).toHaveBeenCalledTimes(1)
		expect(mockTogglePlanActModeProto.mock.calls[0][0].mode).toBe(1)
	})
})
