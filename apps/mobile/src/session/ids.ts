/**
 * Branded ids for the two-level cloud session model.
 *
 * A **remote session** is the outer, REST-managed unit: a cloud sandbox with a
 * URL, a status and an expiry. A **hub session** is an inner unit inside that
 * sandbox: one transcript plus its runs, addressed over the hub protocol.
 *
 * Both are strings on the wire, and mixing them up is the single easiest way to
 * send a command to the wrong thing, so they are branded: the brand exists only
 * in the type system (zero runtime cost) and the constructors are the only way
 * to produce one.
 */

declare const remoteSessionIdBrand: unique symbol;
declare const hubSessionIdBrand: unique symbol;

/** Id of the outer, REST-managed cloud session (sandbox). */
export type RemoteSessionId = string & {
	readonly [remoteSessionIdBrand]: "RemoteSessionId";
};

/** Id of an inner hub session (transcript + runs) inside a sandbox. */
export type HubSessionId = string & {
	readonly [hubSessionIdBrand]: "HubSessionId";
};

function requireId(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error(`A ${label} must be a non-empty string.`);
	}
	return trimmed;
}

export function asRemoteSessionId(value: string): RemoteSessionId {
	return requireId(value, "remote session id") as RemoteSessionId;
}

export function asHubSessionId(value: string): HubSessionId {
	return requireId(value, "hub session id") as HubSessionId;
}
