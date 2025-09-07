import { ServiceClients } from "@adapters/grpcAdapter"

interface Entry {
	requestId: string
	service: keyof ServiceClients
	method: string
	request: any
	response?: any
	status: string
}

export interface SpecFile {
	entries: Entry[]
}
