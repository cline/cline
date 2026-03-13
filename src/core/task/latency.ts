function readBooleanEnv(envVarName: string): boolean {
	const rawValue = process.env[envVarName]?.toLowerCase()
	return rawValue === "1" || rawValue === "true" || rawValue === "yes"
}

export function isEphemeralMessagePersistenceDisabled(): boolean {
	return readBooleanEnv("CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE")
}

export function getEphemeralMessageFlushCadenceMs(): number {
	const rawValue = process.env.CLINE_EPHEMERAL_MESSAGE_FLUSH_CADENCE_MS
	if (!rawValue) {
		return 1500
	}

	const parsed = Number.parseInt(rawValue, 10)
	if (!Number.isFinite(parsed) || parsed < 0) {
		return 1500
	}

	return parsed
}
