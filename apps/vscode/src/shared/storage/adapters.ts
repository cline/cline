import { AwsClient } from "aws4fetch"
import { createHmac } from "crypto"

import { fetch } from "@/shared/net"
import { Logger } from "../services/Logger"
import type { BlobStoreSettings } from "./types"

export interface StorageAdapter {
	read(path: string): Promise<string | undefined>
	write(path: string, value: string): Promise<void>
	remove(path: string): Promise<void>
}

function createAdapter(client: AwsClient, endpoint: string, bucket: string): StorageAdapter {
	const base = `${endpoint}/${bucket}`
	return {
		async read(path: string): Promise<string | undefined> {
			const response = await client.fetch(`${base}/${path}`)
			if (response.status === 404) {
				return undefined
			}
			if (!response.ok) {
				throw new Error(`Failed to read ${path}: ${response.status}`)
			}
			return response.text()
		},

		async write(path: string, value: string): Promise<void> {
			const response = await client.fetch(`${base}/${path}`, {
				method: "PUT",
				body: value,
				headers: {
					"Content-Type": "text/plain",
				},
			})
			if (!response.ok) {
				throw new Error(`Failed to write ${path}: ${response.status}`)
			}
		},

		async remove(path: string): Promise<void> {
			const response = await client.fetch(`${base}/${path}`, {
				method: "DELETE",
			})
			// S3 returns 204 for successful deletes, but also returns 204 for non-existent keys
			if (!response.ok && response.status !== 204) {
				throw new Error(`Failed to remove ${path}: ${response.status}`)
			}
		},
	}
}

function createS3Adapter(settings: BlobStoreSettings): StorageAdapter | undefined {
	const { bucket, accessKeyId, secretAccessKey } = settings

	if (!bucket || !accessKeyId || !secretAccessKey) {
		Logger.error("[StorageAdapter] Missing required S3 settings")
		return undefined
	}

	const region = settings.region || "us-east-1"
	const endpoint = settings.endpoint || `https://s3.${region}.amazonaws.com`
	try {
		const client = new AwsClient({
			region,
			accessKeyId,
			secretAccessKey,
		})
		return createAdapter(client, endpoint, bucket)
	} catch (error) {
		Logger.error("[StorageAdapter] Failed to create S3 adapter:", error)
		return undefined
	}
}

function createR2Adapter(settings: BlobStoreSettings): StorageAdapter | undefined {
	const { accountId, endpoint, bucket, accessKeyId, secretAccessKey } = settings

	if ((!endpoint && !accountId) || !bucket || !accessKeyId || !secretAccessKey) {
		Logger.error("[StorageAdapter] Missing required R2 settings")
		return undefined
	}

	try {
		const client = new AwsClient({
			accessKeyId,
			secretAccessKey,
		})
		const endpoint = settings.endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`
		return createAdapter(client, endpoint, bucket)
	} catch (error) {
		Logger.error("[StorageAdapter] Failed to create R2 adapter:", error)
		return undefined
	}
}

/**
 * Generate Azure Storage Shared Key authorization header.
 * See: https://learn.microsoft.com/en-us/rest/api/storageservices/authorize-with-shared-key
 */
function azureSharedKeyAuth(
	accountName: string,
	accountKey: string,
	method: string,
	path: string,
	headers: Record<string, string>,
): string {
	const contentLength = headers["Content-Length"] || ""
	const contentType = headers["Content-Type"] || ""

	const msHeaders = Object.entries(headers)
		.filter(([k]) => k.toLowerCase().startsWith("x-ms-"))
		.sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
		.map(([k, v]) => `${k.toLowerCase()}:${v}`)
		.join("\n")

	const canonicalizedResource = `/${accountName}${path}`

	const stringToSign = [
		method,
		"", // Content-Encoding
		"", // Content-Language
		contentLength,
		"", // Content-MD5
		contentType,
		"", // Date (empty when x-ms-date is used)
		"", // If-Modified-Since
		"", // If-Match
		"", // If-None-Match
		"", // If-Unmodified-Since
		"", // Range
		msHeaders,
		canonicalizedResource,
	].join("\n")

	const key = Buffer.from(accountKey, "base64")
	const signature = createHmac("sha256", key).update(stringToSign, "utf8").digest("base64")

	return `SharedKey ${accountName}:${signature}`
}

function createAzureAdapter(settings: BlobStoreSettings): StorageAdapter | undefined {
	const { accessKeyId, secretAccessKey, bucket } = settings

	if (!accessKeyId || !secretAccessKey || !bucket) {
		Logger.error("[StorageAdapter] Missing required Azure Blob Storage settings (accessKeyId, secretAccessKey, bucket)")
		return undefined
	}

	const baseUrl = settings.endpoint || `https://${accessKeyId}.blob.core.windows.net`

	try {
		return {
			async read(_: string): Promise<string | undefined> {
				// We don't have a use case to read files yet.
				throw new Error("Reading is not supported")
			},

			async write(path: string, value: string): Promise<void> {
				const blobPath = `/${bucket}/${path}`
				const date = new Date().toUTCString()
				const bodyBuffer = Buffer.from(value, "utf8")
				const contentLength = bodyBuffer.byteLength.toString()
				const headers: Record<string, string> = {
					"x-ms-date": date,
					"x-ms-version": "2024-11-04",
					"x-ms-blob-type": "BlockBlob",
					"Content-Type": "text/plain",
					"Content-Length": contentLength,
				}
				headers["Authorization"] = azureSharedKeyAuth(accessKeyId, secretAccessKey, "PUT", blobPath, headers)

				const response = await fetch(`${baseUrl}${blobPath}`, {
					method: "PUT",
					body: bodyBuffer,
					headers,
				})
				if (!response.ok) {
					const errorBody = await response.text().catch(() => "")
					throw new Error(`Failed to write ${path}: ${response.status} ${errorBody}`)
				}
			},

			async remove(_: string): Promise<void> {
				// We don't need to support removing remote files for our purposes within the extension
				throw new Error("Deleting is not supported")
			},
		}
	} catch (error) {
		Logger.error("[StorageAdapter] Failed to create Azure adapter:", error)
		return undefined
	}
}

export function getStorageAdapter(settings: BlobStoreSettings): StorageAdapter | undefined {
	try {
		const adapterType = settings.adapterType
		if (adapterType === "r2") {
			return createR2Adapter(settings)
		}
		if (adapterType === "s3") {
			return createS3Adapter(settings)
		}
		if (adapterType === "azure") {
			return createAzureAdapter(settings)
		}
		Logger.error(`[StorageAdapter] Invalid adapterType: ${adapterType}. Must be "s3", "r2", or "azure".`)
		return undefined
	} catch (error) {
		Logger.error("[StorageAdapter] Unexpected error creating adapter:", error)
		return undefined
	}
}
