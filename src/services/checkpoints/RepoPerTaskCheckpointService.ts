import * as path from "path"

import { CheckpointServiceOptions } from "./types"
import { ShadowCheckpointService } from "./ShadowCheckpointService"

export class RepoPerTaskCheckpointService extends ShadowCheckpointService {
	public static create({ taskId, workspaceDir, shadowDir, log = console.log }: CheckpointServiceOptions) {
		return new RepoPerTaskCheckpointService(
			taskId,
			path.join(shadowDir, "tasks", taskId, "checkpoints"),
			workspaceDir,
			log,
		)
	}
}
