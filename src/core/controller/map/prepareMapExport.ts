import type { PrepareMapExportRequest, PrepareMapExportResponse } from "@shared/proto/cline/map"
import { MapEvent, PrepareMapExportResponse as PrepareMapExportResponseProto } from "@shared/proto/cline/map"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from ".."

function sanitizeBaseName(input: string | undefined): string {
	const cleaned = (input || `ai-hydro-map-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`)
		.replace(/\.[a-z0-9]+$/i, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
	return cleaned || `ai-hydro-map-${Date.now()}`
}

function primaryExtension(formats: string[]): "png" | "pdf" {
	return formats.map((format) => format.toLowerCase()).includes("pdf") &&
		!formats.map((format) => format.toLowerCase()).includes("png")
		? "pdf"
		: "png"
}

/** Resolve the canonical save destination before the webview performs expensive rendering. */
export async function prepareMapExport(
	controller: Controller,
	request: PrepareMapExportRequest,
): Promise<PrepareMapExportResponse> {
	await controller.refreshMapSessionWorkspaceRoot()

	const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
	const root = workspacePaths.paths[0]
	const baseName = sanitizeBaseName(request.suggestedFilename)
	const extension = primaryExtension(request.formats)
	const defaultDir = root ? path.join(root, "maps") : undefined
	const defaultPath = path.join(defaultDir || process.cwd(), `${baseName}.${extension}`)

	const picked = await HostProvider.window.showSaveDialog({
		options: {
			defaultPath,
			filters: {
				"AI-Hydro map export": { extensions: ["png", "pdf"] },
				"All files": { extensions: ["*"] },
			},
		},
	})

	if (!picked.selectedPath) {
		controller.mapSessionService.appendEvent(
			MapEvent.create({
				type: "map_export.failed",
				source: "user",
				timestampMs: Date.now(),
				payloadJson: JSON.stringify({
					exportId: request.exportId,
					reason: "DESTINATION_CANCELLED",
					message: "Map export cancelled before rendering.",
				}),
			}),
		)
		return PrepareMapExportResponseProto.create({
			accepted: false,
			basePath: "",
			message: "Export cancelled before rendering.",
		})
	}

	const ext = path.extname(picked.selectedPath)
	const basePath = ext ? picked.selectedPath.slice(0, -ext.length) : picked.selectedPath
	return PrepareMapExportResponseProto.create({
		accepted: true,
		basePath,
		message: "Destination confirmed.",
	})
}
