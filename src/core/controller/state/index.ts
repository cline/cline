import { Controller } from "../index"

type StateMethod<Req, Res> = (controller: Controller, request: Req) => Promise<Res>

const methodRegistry: Record<string, StateMethod<any, any>> = {}

/**
 * Register a method with the state service
 * @param name The name of the method
 * @param method The method implementation
 */
export function registerMethod<Req, Res>(name: string, method: StateMethod<Req, Res>): void {
	methodRegistry[name] = method
}

/**
 * Get a method from the registry
 * @param name The name of the method
 * @returns The method implementation or undefined if not found
 */
export function getMethod(name: string): StateMethod<any, any> | undefined {
	return methodRegistry[name]
}

/**
 * Handle a state service request
 * @param controller The controller instance
 * @param method The method name
 * @param message The request message
 * @returns The response message
 */
export async function handleStateServiceRequest(controller: Controller, method: string, message: any): Promise<any> {
	const stateMethod = methodRegistry[method]
	if (!stateMethod) {
		throw new Error(`Unknown method: ${method}`)
	}
	return await stateMethod(controller, message)
}

// Export all methods
export * from "./methods"
