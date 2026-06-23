import { ServiceClients } from "@adapters/grpcAdapter"

export interface Meta {
	synthetic: boolean
	/**
	 * Optional subset of the expected response to validate.
	 * Only the fields specified here will be compared against the actual response.
	 * Useful for partial validation of nested objects or arrays.
	 */
	expected?: any
}

export interface Entry {
	requestId: string
	service: keyof ServiceClients
	method: string
	request: any
	response?: any
	status: string
	meta: Meta
}

export interface SpecFile {
	entries: Entry[]
}
