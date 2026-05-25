import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function cancelBackgroundCommand(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const controllerWithCancel = controller as Controller & {
		cancelBackgroundCommand: () => Promise<void>
	}
	await controllerWithCancel.cancelBackgroundCommand()
	return Empty.create()
}
