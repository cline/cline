import osModule from "node:os"
import { getShell } from "@utils/shell"
import osName from "os-name"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

async function getSystemEnv(isTesting = false) {
	return {
		os: isTesting ? "macOS" : osName(),
		shell: isTesting ? "/bin/zsh" : getShell(),
		homeDir: isTesting ? "/Users/tester" : osModule.homedir(),
		workingDir: isTesting ? "/Users/tester/dev/project" : process.cwd(),
	}
}

export async function getSystemInfo(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const info = await getSystemEnv(context.isTesting)

	// Support custom template from variant overrides
	const template = variant.componentOverrides?.system_info?.template || SYSTEM_INFO_TEMPLATE_TEXT

	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(template, {
		os: info.os,
		shell: info.shell,
		homeDir: info.homeDir,
		workingDir: info.workingDir,
	})
}

const SYSTEM_INFO_TEMPLATE_TEXT = `SYSTEM INFORMATION

Operating System: {{os}}
Default Shell: {{shell}}
Home Directory: {{homeDir}}
Current Working Directory: {{workingDir}}`
