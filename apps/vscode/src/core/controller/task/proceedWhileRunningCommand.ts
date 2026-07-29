import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * "Proceed While Running": detach the in-flight foreground terminal command(s)
 * so the agent turn continues with the partial output while the commands keep
 * running in the user's terminal, streaming further output to a log file.
 */
export async function proceedWhileRunningCommand(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const controllerWithProceed = controller as Controller & {
		proceedWhileRunningCommand: () => Promise<void>
	}
	await controllerWithProceed.proceedWhileRunningCommand()
	return Empty.create()
}
