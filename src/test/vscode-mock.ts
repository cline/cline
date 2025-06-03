export const env = {
	machineId: "test-machine-id",
}

export const workspace = {
	getConfiguration: (section?: string) => ({
		get: (key: string, defaultValue?: any) => defaultValue,
	}),
	onDidChangeConfiguration: (listener: any) => ({ dispose: () => {} }),
}
