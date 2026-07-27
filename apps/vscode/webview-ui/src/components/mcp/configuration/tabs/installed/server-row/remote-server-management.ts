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
 * A matching remote policy protects the server before settings sync writes its
 * persistent remoteConfigured marker. The marker keeps previously managed
 * servers protected while remote policy is loading.
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
