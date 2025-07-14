import { getHostBridgeProvider } from "@/hosts/host-providers"

/**
 * Executes a command using the host bridge.
 * @param command The command to execute
 * @param args Optional arguments for the command
 * @returns The result of the command execution
 */
export async function executeCommand(command: string, ...args: any[]): Promise<any> {
	try {
		// Convert args to strings for the gRPC call
		const stringArgs = args.map((arg) => JSON.stringify(arg))

		const response = await getHostBridgeProvider().commandClient.executeCommand({
			command,
			args: stringArgs,
		})

		// Parse result if it exists
		if (response.result) {
			try {
				return JSON.parse(response.result)
			} catch {
				return response.result
			}
		}
		return undefined
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to execute command: ${errorMessage}`)
	}
}

/**
 * Sets a context value using the host bridge.
 * @param key The context key
 * @param value The context value
 */
export async function setContext(key: string, value: any): Promise<void> {
	try {
		await getHostBridgeProvider().commandClient.setContext({
			key,
			value: JSON.stringify(value),
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to set context: ${errorMessage}`)
	}
}

/**
 * Focuses the sidebar using the host bridge.
 * @param providerId The provider ID to focus
 */
export async function focusSidebar(providerId: string): Promise<void> {
	try {
		await getHostBridgeProvider().commandClient.focusSidebar({
			providerId,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to focus sidebar: ${errorMessage}`)
	}
}

/**
 * Creates a new editor group to the right using the host bridge.
 */
export async function newGroupRight(): Promise<void> {
	try {
		await getHostBridgeProvider().commandClient.newGroupRight({})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to create new group right: ${errorMessage}`)
	}
}

/**
 * Locks the current editor group using the host bridge.
 */
export async function lockEditorGroup(): Promise<void> {
	try {
		await getHostBridgeProvider().commandClient.lockEditorGroup({})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to lock editor group: ${errorMessage}`)
	}
}

/**
 * Opens a walkthrough using the host bridge.
 * @param walkthroughId The walkthrough ID to open
 */
export async function openWalkthrough(walkthroughId: string): Promise<void> {
	try {
		await getHostBridgeProvider().commandClient.openWalkthrough({
			walkthroughId,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to open walkthrough: ${errorMessage}`)
	}
}

/**
 * Reloads the IDE window using the host bridge.
 */
export async function reloadWindow(): Promise<void> {
	try {
		await getHostBridgeProvider().commandClient.reloadWindow({})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to reload window: ${errorMessage}`)
	}
}
