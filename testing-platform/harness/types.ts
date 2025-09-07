interface Entry {
	requestId: string
	service: string
	method: string
	request: any
	response?: any
	status: string // WIP: huh?
}

interface SpecFile {
	startTime: string
	entries: Entry[]
}
