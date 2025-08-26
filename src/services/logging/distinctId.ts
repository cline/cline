import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { EmptyRequest } from "@/shared/proto/cline/common"
import { Logger } from "./Logger"

/*
 * Unique identifiers for the current session
 * NOTE: Unchanged throughout session
 */
const _anonymousId = uuidv4()

let _machineId = ""
let _distinctId = ""

/*
 * Host-provided UUID when running via HostBridge; fall back to VS Code's machineId
 */
export async function getMachineId() {
	try {
		const response = await HostProvider.env.getMachineId(EmptyRequest.create({}))
		_machineId = response.value || vscode.env.machineId
	} catch (e) {
		Logger.warn(`Failed to get machine ID: ${e instanceof Error ? e.message : String(e)}`)
	}
	return _distinctId || _anonymousId
}

/*
 * Set the distinct ID for logging and telemetry.
 * This is updated to Cline User ID when authenticated.
 */
export function setDistinctId(newId: string) {
	_distinctId = newId
}

/*
 * Unique identifier for the current user
 * If authenticated, this will be the Cline User ID.
 * Else, this will be the machine ID, or the anonymous ID as a fallback.
 */
export const getDistinctId = () => _distinctId || _machineId || _anonymousId
