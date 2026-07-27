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
 * A server is remote-managed when the current remote policy has an entry with
 * the same name, or when the persistent remoteConfigured marker recorded prior
 * ownership. Name matching covers the window before remote sync tags on-disk
 * entries with the marker (or after a failed sync); it mirrors the sync
 * behavior, which keys managed servers by name and overwrites same-named
 * entries. URL matching is unsafe here because projected URLs omit query
 * parameters that can distinguish tenants or routes. The marker keeps a
 * previously tagged server protected while remote policy is still loading.
 */
export function getRemoteMcpServerManagement(
	serverName: string,
	projectedConfig: string,
	remoteServers: readonly RemoteMcpServerPolicy[],
): RemoteMcpServerManagement {
	const policy = remoteServers.find((remote) => remote.name === serverName)
	if (policy) {
		return {
			isRemoteManagedServer: true,
			isAlwaysEnabled: policy.alwaysEnabled === true,
		}
	}
	try {
		const config = JSON.parse(projectedConfig)
		return {
			isRemoteManagedServer: config.remoteConfigured === true,
			isAlwaysEnabled: false,
		}
	} catch {
		return { isRemoteManagedServer: false, isAlwaysEnabled: false }
	}
}
