import { Controller } from "../index"
import { methodRegistry } from "./methods"

type WebContentServiceMethod = keyof typeof methodRegistry

/**
 * Handle a web content service request
 * @param controller The controller instance
 * @param method The method name
 * @param message The request message
 * @returns The response message
 */
export async function handleWebContentServiceRequest(controller: Controller, method: string, message: any): Promise<any> {
	const methodHandler = methodRegistry[method as WebContentServiceMethod]
	if (!methodHandler) {
		throw new Error(`Unknown WebContentService method: ${method}`)
	}
	return methodHandler(controller, message)
}
