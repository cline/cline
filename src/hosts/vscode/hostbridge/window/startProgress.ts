import { window, ProgressLocation as VscodeProgressLocation } from "vscode"
import { StartProgressRequest, StartProgressResponse, ProgressLocation } from "@/shared/proto/index.host"
import { v4 as uuidv4 } from "uuid"

// Map to track active progress instances
const progressMap = new Map<string, () => void>()

function mapProgressLocation(location: ProgressLocation): VscodeProgressLocation {
	switch (location) {
		case ProgressLocation.NOTIFICATION:
			return VscodeProgressLocation.Notification
		case ProgressLocation.SOURCE_CONTROL:
			return VscodeProgressLocation.SourceControl
		case ProgressLocation.WINDOW:
			return VscodeProgressLocation.Window
		default:
			return VscodeProgressLocation.Notification
	}
}

export async function startProgress(request: StartProgressRequest): Promise<StartProgressResponse> {
	const { location, title, cancellable } = request
	const progressId = uuidv4()

	// Start the VS Code progress but keep it alive until endProgress is called
	window.withProgress(
		{
			location: mapProgressLocation(location),
			title,
			cancellable,
		},
		async () => {
			// Keep the progress alive until endProgress is called
			return new Promise<void>((resolve) => {
				progressMap.set(progressId, resolve)
			})
		},
	)

	return StartProgressResponse.create({ progressId })
}

// Export the progress map for use by endProgress
export { progressMap }
