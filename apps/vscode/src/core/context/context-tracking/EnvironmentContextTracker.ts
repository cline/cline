import { collectEnvironmentMetadata, getTaskMetadata, saveTaskMetadata } from "@core/storage/disk"
import type { EnvironmentMetadataEntry } from "./ContextTrackerTypes"

export class EnvironmentContextTracker {
	readonly taskId: string

	constructor(taskId: string) {
		this.taskId = taskId
	}

	async recordEnvironment() {
		const metadata = await getTaskMetadata(this.taskId)

		if (!metadata.environment_history) {
			metadata.environment_history = []
		}

		const currentEnv = await collectEnvironmentMetadata()
		const currentEnvWithTs: EnvironmentMetadataEntry = {
			ts: Date.now(),
			...currentEnv,
		}

		const lastEntry = metadata.environment_history[metadata.environment_history.length - 1]
		if (lastEntry && this.isSameEnvironment(lastEntry, currentEnvWithTs)) {
			return // No change, don't add duplicate
		}

		metadata.environment_history.push(currentEnvWithTs)
		await saveTaskMetadata(this.taskId, metadata)
	}

	private isSameEnvironment(a: EnvironmentMetadataEntry, b: EnvironmentMetadataEntry): boolean {
		return (
			a.os_name === b.os_name &&
			a.os_version === b.os_version &&
			a.os_arch === b.os_arch &&
			a.host_name === b.host_name &&
			a.host_version === b.host_version &&
			a.cline_version === b.cline_version
		)
	}
}
