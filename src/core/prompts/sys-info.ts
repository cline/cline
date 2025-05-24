/**
 * Contains system information that Cline provides to models
 */
import { getShell } from "@utils/shell"
import os from "os"
import osName from "os-name"

export const getSysInfoContent = (cwd: string): string => {
	return `
====

SYSTEM INFORMATION

Operating System: ${osName()}
Default Shell: ${getShell()}
Home Directory: ${os.homedir().toPosix()}
Current Working Directory: ${cwd.toPosix()}`
}
