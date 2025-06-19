import { Controller } from "../index"
import { Empty, StringRequest } from "../../../shared/proto/common"

/**
 * Handles identifying a user via email for telemetry.
 *
 * @param controller The controller instance, providing access to other services.
 * @param request The request object containing the email.
 * @returns An empty response to signify success.
 */
export async function accountEmailIdentified(controller: Controller, request: StringRequest): Promise<Empty> {
	const email = request.value
	console.log(`Identifying user with email: ${email}`)

	// Here you would call the telemetry service
	// controller.telemetry.identify(email);

	return Empty.create({})
}
