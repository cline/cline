import { Boolean } from "@shared/proto/bedrock_coder/common"
import { isBedrockCoderCliInstalled } from "@/utils/cli-detector"
import { Controller } from ".."

/**
 * Check if the BedrockCoder CLI is installed
 * @param controller The controller instance
 * @returns Boolean indicating if CLI is installed
 */
export async function checkCliInstallation(_controller: Controller): Promise<Boolean> {
	try {
		const isInstalled = await isBedrockCoderCliInstalled()
		return Boolean.create({ value: isInstalled })
	} catch {
		return Boolean.create({ value: false })
	}
}
