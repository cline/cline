/**
 * Environment variables for S3/R2 storage configuration.
 * - CLINE_STORAGE_ADAPTER: "s3" | "r2" (required to enable S3 storage)
 * - CLINE_STORAGE_BUCKET: S3/R2 bucket name (required)
 * - CLINE_STORAGE_REGION: AWS region (default: "us-east-1", S3 only)
 * - CLINE_STORAGE_ACCESS_KEY_ID: AWS access key ID (required)
 * - CLINE_STORAGE_SECRET_ACCESS_KEY: AWS secret access key (required)
 * - CLINE_STORAGE_ACCOUNT_ID: Cloudflare account ID (R2 only)
 */

import { AwsClient } from "aws4fetch"

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
				console.error("Error in write:", error)
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

function createS3Adapter(): StorageAdapter | undefined {
	const bucket = process.env.CLINE_STORAGE_BUCKET
	const accessKeyId = process.env.CLINE_STORAGE_ACCESS_KEY_ID
	const secretAccessKey = process.env.CLINE_STORAGE_SECRET_ACCESS_KEY

	if (!bucket || !accessKeyId || !secretAccessKey) {
		console.error("[StorageAdapter] Missing required S3 environment variables")
		return undefined
	}

	const region = process.env.CLINE_STORAGE_REGION || "us-east-1"
	const endpoint = process.env.CLINE_STORAGE_ENDPOINT
		? process.env.CLINE_STORAGE_ENDPOINT
		: `https://s3.${region}.amazonaws.com`
	try {
		const client = new AwsClient({
			region,
			accessKeyId,
			secretAccessKey,
		})
		return createAdapter(client, endpoint, bucket)
	} catch (error) {
		console.error("[StorageAdapter] Failed to create S3 adapter:", error)
		return undefined
	}
}

function createR2Adapter(): StorageAdapter | undefined {
	const accountId = process.env.CLINE_STORAGE_ACCOUNT_ID
	const bucket = process.env.CLINE_STORAGE_BUCKET
	const accessKeyId = process.env.CLINE_STORAGE_ACCESS_KEY_ID
	const secretAccessKey = process.env.CLINE_STORAGE_SECRET_ACCESS_KEY

	if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
		console.error("[StorageAdapter] Missing required R2 environment variables")
		return undefined
	}

	try {
		const client = new AwsClient({
			accessKeyId,
			secretAccessKey,
		})
		const endpoint = process.env.CLINE_STORAGE_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`
		return createAdapter(client, endpoint, bucket)
	} catch (error) {
		console.error("[StorageAdapter] Failed to create R2 adapter:", error)
		return undefined
	}
}

export function getStorageAdapter(adapterType: string): StorageAdapter | undefined {
	try {
		if (adapterType === "r2") {
			return createR2Adapter()
		} else if (adapterType === "s3") {
			return createS3Adapter()
		} else {
			console.error(`[StorageAdapter] Invalid CLINE_STORAGE_ADAPTER: ${adapterType}. Must be "s3" or "r2".`)
			return undefined
		}
	} catch (error) {
		console.error("[StorageAdapter] Unexpected error creating adapter:", error)
		return undefined
	}
}
