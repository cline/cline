export const DEFAULT_REMOTE_ENVIRONMENT_PORT = 22;

export type RemoteEnvironmentProfile = {
	id?: string;
	name: string;
	host: string;
	user?: string;
	port?: number;
	identityFile?: string;
};

export type RemoteEnvironmentListResult = {
	profiles: RemoteEnvironmentProfile[];
	activeEnvironmentId: string;
	activeProfileId: string | null;
	statuses: RemoteEnvironmentStatus[];
};

export type RemoteEnvironmentStatus = {
	profileId: string;
	state:
		| "disconnected"
		| "testing"
		| "available"
		| "connecting"
		| "connected"
		| "error";
	updatedAt: string;
	message?: string;
	remotePlatform?: "linux" | "darwin";
	remoteArch?: "x64" | "arm64";
	remoteHome?: string;
};

export type RemoteEnvironmentUpsertResult = {
	profile: RemoteEnvironmentProfile;
};

export type RemoteEnvironmentTestResult = {
	profile?: RemoteEnvironmentProfile;
	status: "passed" | "failed";
	message?: string;
	remotePlatform?: string;
	remoteArch?: string;
};

export type RemoteEnvironmentConnectResult = {
	profile: RemoteEnvironmentProfile;
	status: "connected";
	environmentId: string;
	activeEnvironmentId: string;
	activeProfileId: string;
	homeDir: string;
	workspaceRoot: string;
	remotePlatform?: string;
	remoteArch?: string;
};

export type RemoteEnvironmentDisconnectResult = {
	status: "disconnected";
	disconnectedProfileId: string | null;
	activeEnvironmentId: string;
	activeProfileId: string | null;
};

export type RemoteEnvironmentDeleteResult = {
	deleted: boolean;
	activeEnvironmentId: string;
	activeProfileId: string | null;
};

export type RemoteEnvironmentTestState =
	| "untested"
	| "testing"
	| "passed"
	| "failed";

export type RemoteEnvironmentBootstrapState =
	| "unknown"
	| "installing"
	| "ready"
	| "failed";

export type RemoteEnvironmentConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "disconnecting"
	| "error";

export type RemoteEnvironmentRuntimeState = {
	test: RemoteEnvironmentTestState;
	bootstrap: RemoteEnvironmentBootstrapState;
	connection: RemoteEnvironmentConnectionState;
	message?: string;
	remotePlatform?: string;
	remoteArch?: string;
};

export const DEFAULT_REMOTE_ENVIRONMENT_RUNTIME_STATE: RemoteEnvironmentRuntimeState =
	{
		test: "untested",
		bootstrap: "unknown",
		connection: "disconnected",
	};

export function createRemoteEnvironmentDraft(
	profile?: RemoteEnvironmentProfile,
): RemoteEnvironmentProfile {
	return {
		id: profile?.id,
		name: profile?.name ?? "",
		host: profile?.host ?? "",
		user: profile?.user,
		port: profile?.port,
		identityFile: profile?.identityFile,
	};
}

function trimmedOptional(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function normalizeRemoteEnvironmentProfile(
	profile: RemoteEnvironmentProfile,
): RemoteEnvironmentProfile {
	return {
		id: trimmedOptional(profile.id),
		name: profile.name.trim(),
		host: profile.host.trim(),
		user: trimmedOptional(profile.user),
		port: profile.port,
		identityFile: trimmedOptional(profile.identityFile),
	};
}

export function validateRemoteEnvironmentProfile(
	profile: RemoteEnvironmentProfile,
): string | undefined {
	if (!profile.name.trim()) return "Name is required.";
	if (!profile.host.trim()) return "SSH host is required.";
	if (
		profile.port !== undefined &&
		(!Number.isInteger(profile.port) ||
			profile.port < 1 ||
			profile.port > 65_535)
	) {
		return "Port must be a whole number between 1 and 65535.";
	}
	return undefined;
}

export function formatRemoteEnvironmentDestination(
	profile: Pick<RemoteEnvironmentProfile, "host" | "user" | "port">,
): string {
	const host = profile.host.trim();
	const user = profile.user?.trim();
	const destination = user ? `${user}@${host}` : host;
	return profile.port === undefined ||
		profile.port === DEFAULT_REMOTE_ENVIRONMENT_PORT
		? destination
		: `${destination}:${profile.port}`;
}
