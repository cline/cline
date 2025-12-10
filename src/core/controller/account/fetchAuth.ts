import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import { AuthService } from "@/services/auth/AuthService"
import type { Controller } from "../index"

/**
 * Handles triggering restoring the auth data
 * @param controller The controller instance
 * @param _request The empty request object
 * @returns Empty response
 */
export async function fetchAuth(_: Controller, _request: EmptyRequest): Promise<Empty> {
	await AuthService.getInstance().retryRestore()
	return Empty.create({})
}
