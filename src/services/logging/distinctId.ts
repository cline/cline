import { v4 as uuidv4 } from "uuid"
import { ExtensionContext } from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { EmptyRequest } from "@/shared/proto/cline/common"
import { Logger } from "./Logger"

/*
 * Unique identifier for the current installation.
 */
let _distinctId: string = ""
/*
 * Function to store the distinct ID persistently.
 */
let storeDistinctId: ((id: string) => void) | null = null

export async function initializeDistinctId(context: ExtensionContext, uuid: () => string = uuidv4) {
	// NOTE: Backward compatibility in case where cline.distinctId was set in older versions
	const globalStore = context.globalState
	const existingId = globalStore?.get<string>("cline.distinctId")
	const machineId = await getMachineId()
	let distinctId = existingId || machineId

	if (!distinctId) {
		console.warn("No machine ID found, generating UUID")
		distinctId = uuid()
	}

	setDistinctId(distinctId)

	if (process.env.IS_DEV) {
		console.log("Telemetry distinct ID initialized:", distinctId)
	}

	storeDistinctId = (id: string) => globalStore.update("cline.distinctId", id)
}

/*
 * Host-provided UUID when running via HostBridge; fall back to VS Code's machineId
 */
async function getMachineId(): Promise<string | undefined> {
	try {
		const response = await HostProvider.env.getMachineId(EmptyRequest.create({}))
		return response.value
	} catch (e) {
		Logger.warn(`Failed to get machine ID: ${e instanceof Error ? e.message : String(e)}`)
		return undefined
	}
}

/*
 * Set the distinct ID for logging and telemetry.
 * This is updated to Cline User ID when authenticated.
 */
export function setDistinctId(newId: string) {
	if (_distinctId && _distinctId !== newId) {
		storeDistinctId?.(newId)
		console.log(`Changing telemetry ID from ${_distinctId} to ${newId}.`)
	}
	_distinctId = newId
}

/*
 * Unique identifier for the current user
 * If authenticated, this will be the Cline User ID.
 * Else, this will be the machine ID, or the anonymous ID as a fallback.
 */
export function getDistinctId() {
	if (!_distinctId) {
		console.error("Telemetry ID is not initialized. Call initializeDistinctId() first.")
	}
	return _distinctId
}
