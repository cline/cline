import type { MapExportOutput, SaveMapExportRequest, SaveMapExportResponse } from "@shared/proto/cline/map"
import {
	MapEvent,
	MapExportOutput as MapExportOutputProto,
	SaveMapExportResponse as SaveMapExportResponseProto,
} from "@shared/proto/cline/map"
import { writeFile } from "@utils/fs"
import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import type { Controller } from ".."

function normalizedFormat(format: string): "png" | "pdf" {
	const lower = format.toLowerCase()
	if (lower === "pdf") {
		return "pdf"
	}
	return "png"
}

function checksum(bytes: Uint8Array): string {
	return crypto.createHash("sha256").update(bytes).digest("hex")
}

async function writeBytes(filePath: string, bytes: Uint8Array): Promise<MapExportOutput> {
	await writeFile(filePath, bytes)
	return MapExportOutputProto.create({
		format: path.extname(filePath).replace(/^\./, "") || "artifact",
		uri: `file://${filePath}`,
		filename: path.basename(filePath),
		sha256: checksum(bytes),
		sizeBytes: bytes.byteLength,
	})
}

/** Persist export artifacts through the extension host and emit completion only after writes succeed. */
export async function saveMapExport(controller: Controller, request: SaveMapExportRequest): Promise<SaveMapExportResponse> {
	const outputs: MapExportOutput[] = []
	try {
		if (!request.basePath?.trim()) {
			throw new Error("Missing export base path")
		}
		if (!request.artifacts.length) {
			throw new Error("No export artifacts were provided")
		}

		const dir = path.dirname(request.basePath)
		await fs.mkdir(dir, { recursive: true })

		for (const artifact of request.artifacts) {
			const format = normalizedFormat(artifact.format)
			const filePath = `${request.basePath}.${format}`
			if (!artifact.dataBase64) {
				throw new Error(`Missing ${format.toUpperCase()} artifact data`)
			}
			const bytes = Buffer.from(artifact.dataBase64, "base64")
			outputs.push(await writeBytes(filePath, bytes))
		}

		let manifest: Record<string, unknown> = {}
		if (request.manifestJson?.trim()) {
			try {
				manifest = JSON.parse(request.manifestJson) as Record<string, unknown>
			} catch {
				manifest = { manifestParseWarning: "Original manifest JSON could not be parsed by extension host." }
			}
		}
		manifest.outputs = outputs.map((output) => ({
			format: output.format,
			uri: output.uri,
			filename: output.filename,
			sha256: output.sha256,
			sizeBytes: output.sizeBytes,
		}))
		const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8")
		const manifestPath = `${request.basePath}.map-provenance.json`
		outputs.push(await writeBytes(manifestPath, manifestBytes))
		outputs[outputs.length - 1].format = "provenance"

		controller.mapSessionService.appendEvent(
			MapEvent.create({
				type: "map_export.completed",
				source: "system",
				timestampMs: Date.now(),
				payloadJson: JSON.stringify({
					exportId: request.exportId,
					outputFiles: outputs.map((output) => ({
						format: output.format,
						uri: output.uri,
						sha256: output.sha256,
						sizeBytes: output.sizeBytes,
					})),
				}),
			}),
		)

		return SaveMapExportResponseProto.create({ ok: true, outputs, message: "Map export written." })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		controller.mapSessionService.appendEvent(
			MapEvent.create({
				type: "map_export.failed",
				source: "system",
				timestampMs: Date.now(),
				payloadJson: JSON.stringify({
					exportId: request.exportId,
					reason: "WRITE_FAILED",
					message,
				}),
			}),
		)
		return SaveMapExportResponseProto.create({ ok: false, outputs, message })
	}
}
