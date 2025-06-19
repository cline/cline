import { Controller } from "../index"
import { Empty, StringRequest } from "../../../shared/proto/common"
import { telemetryService } from "../../../services/posthog/telemetry/TelemetryService"

/**
 * Handles identifying a user via email for telemetry.
 *
 * @param controller The controller instance, providing access to other services.
 * @param request The request object containing the email.
 * @returns An empty response to signify success.
 */
export async function accountEmailIdentified(controller: Controller, request: StringRequest): Promise<Empty> {
	const email = request.value
	telemetryService.identifyUser(email)

	return Empty.create({})
}
