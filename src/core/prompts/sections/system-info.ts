import defaultShell from "default-shell"
import os from "os"
import osName from "os-name"
import { Mode, ModeConfig, getModeBySlug, defaultModeSlug, isToolAllowedForMode } from "../../../shared/modes"
import { getShell } from "../../../utils/shell"

export function getSystemInfoSection(cwd: string, currentMode: Mode, customModes?: ModeConfig[]): string {
	const findModeBySlug = (slug: string, modes?: ModeConfig[]) => modes?.find((m) => m.slug === slug)

	const currentModeName = findModeBySlug(currentMode, customModes)?.name || currentMode
	const codeModeName = findModeBySlug(defaultModeSlug, customModes)?.name || "Code"

	let details = `====

SYSTEM INFORMATION

Operating System: ${osName()}
Default Shell: ${getShell()}
Home Directory: ${os.homedir().toPosix()}
Current Working Directory: ${cwd.toPosix()}

When the user initially gives you a task, a recursive list of all filepaths in the current working directory ('/test/path') will be included in environment_details. This provides an overview of the project's file structure, offering key insights into the project from directory/file names (how developers conceptualize and organize their code) and file extensions (the language used). This can also guide decision-making on which files to explore further. If you need to further explore directories such as outside the current working directory, you can use the list_files tool. If you pass 'true' for the recursive parameter, it will list files recursively. Otherwise, it will list files at the top level, which is better suited for generic directories where you don't necessarily need the nested structure, like the Desktop.`

	return details
}
