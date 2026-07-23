type RemoteMcpServerPolicy = {
	name: string
	url: string
	alwaysEnabled?: boolean
}

export type RemoteMcpServerManagement = {
	isRemoteManagedServer: boolean
	isAlwaysEnabled: boolean
}

/**
 * The persistent remoteConfigured marker is the source of truth for ownership.
 * URL matching is unsafe here because projected URLs omit query parameters that
 * can distinguish tenants or routes. The server name identifies the matching
 * policy entry only after ownership has been established by the marker.
 */
export function getRemoteMcpServerManagement(
	serverName: string,
	projectedConfig: string,
	remoteServers: readonly RemoteMcpServerPolicy[],
): RemoteMcpServerManagement {
	try {
		const config = JSON.parse(projectedConfig)
		if (config.remoteConfigured !== true) {
			return { isRemoteManagedServer: false, isAlwaysEnabled: false }
		}

		const policy = remoteServers.find((remote) => remote.name === serverName)
		return {
			isRemoteManagedServer: true,
			isAlwaysEnabled: policy?.alwaysEnabled === true,
		}
	} catch {
		return { isRemoteManagedServer: false, isAlwaysEnabled: false }
	}
}
