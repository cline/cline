import { Boolean } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function checkCliInstallation(_controller: Controller): Promise<Boolean> {
	return Boolean.create({ value: false })
}
