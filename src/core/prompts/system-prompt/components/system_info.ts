import osModule from "node:os"
import { getShell } from "@utils/shell"
import osName from "os-name"
import { getWorkspacePaths } from "@/hosts/vscode/hostbridge/workspace/getWorkspacePaths"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const SYSTEM_INFO_TEMPLATE_TEXT = `SYSTEM INFORMATION

Operating System: {{os}}
Default Shell: {{shell}}
Home Directory: {{homeDir}}
{{WORKSPACE_TITLE}}: {{workingDir}}`

export async function getSystemEnv(cwd?: string, isTesting = false) {
	const currentWorkDir = cwd || process.cwd()
	const workspaces = (await getWorkspacePaths({}))?.paths || [currentWorkDir]
	return isTesting
		? {
				os: "macOS",
				shell: "/bin/zsh",
				homeDir: "/Users/tester",
				workingDir: "/Users/tester/dev/project",
				// Multi-root workspace example: ["/Users/tester/dev/project", "/Users/tester/dev/foo", "/Users/tester/bar"],
				workspaces: ["/Users/tester/dev/project"],
			}
		: {
				os: osName(),
				shell: getShell(),
				homeDir: osModule.homedir(),
				workingDir: currentWorkDir,
				workspaces: workspaces,
			}
}

export async function getSystemInfo(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const testMode = !!process?.env?.CI || !!process?.env?.IS_DEV || context.isTesting || false
	const info = await getSystemEnv(context.cwd, testMode)
	const WORKSPACE_TITLE =
		!info.workspaces || info.workspaces.length === 1 ? "Current Working Directory" : "Active Workspace Folders"

	const template = variant.componentOverrides?.[SystemPromptSection.SYSTEM_INFO]?.template || SYSTEM_INFO_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, {
		os: info.os,
		shell: info.shell,
		homeDir: info.homeDir,
		WORKSPACE_TITLE,
		workingDir: info.workspaces.length > 1 ? info.workspaces.join(", ") : info.workingDir,
	})
}
