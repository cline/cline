import osModule from "node:os"
import { getShell } from "@utils/shell"
import osName from "os-name"
import { getWorkspacePaths } from "@/hosts/vscode/hostbridge/workspace/getWorkspacePaths"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const SYSTEM_INFO_TEMPLATE_TEXT = `SYSTEM INFORMATION

Operating System: {{os}}
IDE: {{ide}}
Default Shell: {{shell}}
Home Directory: {{homeDir}}
{{WORKSPACE_TITLE}}: {{workingDir}}`

/**
 * Get the shell that will actually be used for command execution.
 * When using background exec mode, commands run in the system default shell
 * (cmd.exe on Windows, /bin/bash on Unix), not the VS Code configured shell.
 */
function getEffectiveShell(context: SystemPromptContext): string {
	if (context.terminalExecutionMode === "backgroundExec") {
		// Background exec uses the system default shell, not VS Code config
		if (process.platform === "win32") {
			return process.env.COMSPEC || "cmd.exe"
		} else {
			return process.env.SHELL || "/bin/bash"
		}
	}
	// VS Code terminal mode (or undefined) uses the VS Code configured shell
	return getShell()
}

export async function getSystemEnv(context: SystemPromptContext, isTesting = false) {
	const currentWorkDir = context.cwd || process.cwd()
	const workspaces = (await getWorkspacePaths({}))?.paths || [currentWorkDir]
	return isTesting
		? {
				os: "macOS",
				ide: "TestIde",
				shell: "/bin/zsh",
				homeDir: "/Users/tester",
				workingDir: "/Users/tester/dev/project",
				// Multi-root workspace example: ["/Users/tester/dev/project", "/Users/tester/dev/foo", "/Users/tester/bar"],
				workspaces: ["/Users/tester/dev/project"],
			}
		: {
				os: osName(),
				ide: context.ide,
				shell: getEffectiveShell(context),
				homeDir: osModule.homedir(),
				workingDir: currentWorkDir,
				workspaces: workspaces,
			}
}

export async function getSystemInfo(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const testMode = !!process?.env?.CI || !!process?.env?.IS_TEST || context.isTesting || false
	const info = await getSystemEnv(context, testMode)

	// Check if multi-root is enabled and we have workspace roots
	const isMultiRoot = context.isMultiRootEnabled && context.workspaceRoots && context.workspaceRoots.length > 1

	let WORKSPACE_TITLE: string
	let workingDirInfo: string

	if (isMultiRoot && context.workspaceRoots) {
		// Multi-root workspace with feature flag enabled
		WORKSPACE_TITLE = "Workspace Roots"
		const rootsInfo = context.workspaceRoots
			.map((root) => {
				const vcsInfo = root.vcs ? ` (${root.vcs})` : ""
				return `\n  - ${root.name}: ${root.path}${vcsInfo}`
			})
			.join("")
		workingDirInfo = rootsInfo + `\n\nPrimary Working Directory: ${context.cwd}`
	} else {
		// Single workspace
		WORKSPACE_TITLE = "Current Working Directory"
		workingDirInfo = info.workingDir
	}

	const template = variant.componentOverrides?.[SystemPromptSection.SYSTEM_INFO]?.template || SYSTEM_INFO_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, context, {
		os: info.os,
		ide: info.ide,
		shell: info.shell,
		homeDir: info.homeDir,
		WORKSPACE_TITLE,
		workingDir: workingDirInfo,
	})
}
