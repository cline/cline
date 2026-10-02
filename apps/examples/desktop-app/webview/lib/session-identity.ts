/** Stable UI identity; the runtime session ID remains unchanged on the wire. */
export function sessionKey(session: {
	sessionId: string;
	environmentId?: string;
}): string {
	return JSON.stringify([session.environmentId ?? "local", session.sessionId]);
}

export function eventEnvironmentId(payload: unknown): string {
	return payload &&
		typeof payload === "object" &&
		"environmentId" in payload &&
		typeof payload.environmentId === "string"
		? payload.environmentId
		: "local";
}
