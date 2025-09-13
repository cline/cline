import osModule from "node:os"
import { getShell } from "@utils/shell"
import osName from "os-name"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const SYSTEM_INFO_TEMPLATE_TEXT = `SYSTEM INFORMATION

Operating System: {{os}}
Default Shell: {{shell}}
Home Directory: {{homeDir}}
Current Working Directory: {{workingDir}}`

export async function getSystemEnv(cwd?: string, isTesting = false) {
	return {
		os: isTesting ? "macOS" : osName(),
		shell: isTesting ? "/bin/zsh" : getShell(),
		homeDir: isTesting ? "/Users/tester" : osModule.homedir(),
		workingDir: isTesting ? "/Users/tester/dev/project" : cwd || process.cwd(),
	}
}

export async function getSystemInfo(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const testMode = !!process?.env?.CI || !!process?.env?.IS_DEV || context.isTesting || false
	const info = await getSystemEnv(context.cwd, testMode)

	const template = variant.componentOverrides?.[SystemPromptSection.SYSTEM_INFO]?.template || SYSTEM_INFO_TEMPLATE_TEXT

	return new TemplateEngine().resolve(template, {
		os: info.os,
		shell: info.shell,
		homeDir: info.homeDir,
		workingDir: info.workingDir,
	})
}
