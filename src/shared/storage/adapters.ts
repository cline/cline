import { AwsClient } from "aws4fetch"
import { Logger } from "../services/Logger"
import type { BlobStoreSettings } from "./ClineBlobStorage"

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
			try {
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
			} catch (error) {
				Logger.error("Error in write:", error)
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
	const { accountId, bucket, accessKeyId, secretAccessKey } = settings

	if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
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

export function getStorageAdapter(settings: BlobStoreSettings): StorageAdapter | undefined {
	try {
		const adapterType = settings.adapterType
		if (adapterType === "r2") {
			return createR2Adapter(settings)
		} else if (adapterType === "s3") {
			return createS3Adapter(settings)
		} else {
			Logger.error(`[StorageAdapter] Invalid adapterType: ${adapterType}. Must be "s3" or "r2".`)
			return undefined
		}
	} catch (error) {
		Logger.error("[StorageAdapter] Unexpected error creating adapter:", error)
		return undefined
	}
}
