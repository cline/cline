import { ServiceClients } from "@adapters/grpcAdapter"

export interface Meta {
	synthetic: boolean
	expect: any
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
