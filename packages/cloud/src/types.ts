export interface CloudServiceCallbacks {
	stateChanged?: () => void
	log?: (...args: unknown[]) => void
}
