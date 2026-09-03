import { GitHubConnection, GitHubRepository } from "@shared/proto/cline/cloud"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { CloudSessionError } from "@/services/cloud/CloudSessionsService"
import type { Controller } from "../index"

/**
 * GitHub App connection status for the active account scope, with the
 * repositories the Cline GitHub App can access.
 */
export async function getGitHubConnection(controller: Controller, _request: EmptyRequest): Promise<GitHubConnection> {
	const signedIn = !!controller.authService.getInfo().user?.uid
	if (!signedIn) {
		return GitHubConnection.create({
			signedIn: false,
			connected: false,
			connectUrl: controller.cloudSessions.githubConnectUrl(),
		})
	}
	try {
		const result = await controller.cloudSessions.getGitHubConnection()
		return GitHubConnection.create({
			signedIn: true,
			connected: result.connected,
			connectUrl: result.connectUrl,
			repositories: result.repositories.map((repository) =>
				GitHubRepository.create({
					id: repository.id,
					name: repository.name,
					fullName: repository.fullName,
					url: repository.url,
					defaultBranch: repository.defaultBranch,
				}),
			),
		})
	} catch (error) {
		if (error instanceof CloudSessionError && error.code === "authentication_required") {
			return GitHubConnection.create({
				signedIn: false,
				connected: false,
				connectUrl: controller.cloudSessions.githubConnectUrl(),
			})
		}
		return GitHubConnection.create({
			signedIn: true,
			connected: false,
			connectUrl: controller.cloudSessions.githubConnectUrl(),
			error: error instanceof Error ? error.message : String(error),
		})
	}
}
