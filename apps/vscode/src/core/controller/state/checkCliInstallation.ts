import { Boolean } from "@shared/proto/cline/common"
import { isClineCliInstalled } from "@/utils/cli-detector"
import { Controller } from ".."

/**
 * Check if the Cline CLI is installed
 * @param controller The controller instance
 * @returns Boolean indicating if CLI is installed
 */
export async function checkCliInstallation(_controller: Controller): Promise<Boolean> {
	try {
		const isInstalled = await isClineCliInstalled()
		return Boolean.create({ value: isInstalled })
	} catch {
		return Boolean.create({ value: false })
	}
}
