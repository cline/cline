import { Controller } from "../../../src/core/controller"
import { ServiceMethodHandler } from "../../../src/core/controller/grpc-service"
import { file } from "./file"
import { joinPath } from "./joinPath"
import { parse } from "./parse"

/**
 * Creates an adapter that wraps a host function to match the ServiceMethodHandler interface
 * @param hostFn The host function that doesn't need a controller
 * @returns A function that matches the ServiceMethodHandler interface
 */
export function createHostAdapter<T, R>(hostFn: (request: T) => Promise<R>): ServiceMethodHandler {
	return async (controller: Controller, request: T): Promise<R> => {
		// Simply pass the request to the host function, ignoring the controller
		return hostFn(request)
	}
}

// Create adapted versions of the host functions
export const fileAdapter = createHostAdapter(file)
export const joinPathAdapter = createHostAdapter(joinPath)
export const parseAdapter = createHostAdapter(parse)
