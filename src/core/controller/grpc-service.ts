import { Controller } from "./index"

/**
 * Generic type for service method handlers
 */
export type ServiceMethodHandler = (controller: Controller, message: any) => Promise<any>

/**
 * Generic service registry for gRPC services
 */
export class ServiceRegistry {
	private serviceName: string
	private methodRegistry: Record<string, ServiceMethodHandler> = {}

	/**
	 * Create a new service registry
	 * @param serviceName The name of the service (used for logging)
	 */
	constructor(serviceName: string) {
		this.serviceName = serviceName
	}

	/**
	 * Register a method handler
	 * @param methodName The name of the method to register
	 * @param handler The handler function for the method
	 */
	registerMethod(methodName: string, handler: ServiceMethodHandler): void {
		this.methodRegistry[methodName] = handler
		console.log(`Registered ${this.serviceName} method: ${methodName}`)
	}

	/**
	 * Handle a service request
	 * @param controller The controller instance
	 * @param method The method name
	 * @param message The request message
	 * @returns The response message
	 */
	async handleRequest(controller: Controller, method: string, message: any): Promise<any> {
		const handler = this.methodRegistry[method]

		if (!handler) {
			throw new Error(`Unknown ${this.serviceName} method: ${method}`)
		}

		return handler(controller, message)
	}
}

/**
 * Create a service registry factory function
 * @param serviceName The name of the service
 * @returns An object with register and handle functions
 */
export function createServiceRegistry(serviceName: string) {
	const registry = new ServiceRegistry(serviceName)

	return {
		registerMethod: (methodName: string, handler: ServiceMethodHandler) => registry.registerMethod(methodName, handler),

		handleRequest: (controller: Controller, method: string, message: any) =>
			registry.handleRequest(controller, method, message),
	}
}
