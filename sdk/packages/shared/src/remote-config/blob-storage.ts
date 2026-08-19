import { createHmac } from "node:crypto";
import { basename } from "node:path";
import { AwsClient } from "aws4fetch";
import type {
	PromptUploading,
	RemoteConfig,
	S3AccessKeySettings,
} from "./schema";

export interface RemoteConfigBlobStoreSettings {
	bucket: string;
	adapterType: "s3" | "r2" | "azure";
	accessKeyId: string;
	secretAccessKey: string;
	region?: string;
	endpoint?: string;
	accountId?: string;
}

export interface RemoteConfigBlobStoreTarget {
	bucket: string;
	adapterType: "s3" | "r2" | "azure";
	region?: string;
	endpoint?: string;
	accountId?: string;
}

export interface RemoteConfigBlobStorageAdapter {
	write(path: string, value: string): Promise<void>;
}

export interface RemoteConfigSessionBlobUploadMetadata {
	version: 1;
	storage: RemoteConfigBlobStoreTarget;
	keyPrefix?: string;
	userDistinctId?: string;
}

export interface RemoteConfigSessionMetadataRow {
	metadata?: Record<string, unknown> | null;
}

export interface RemoteConfigSessionMessagesUploadInput {
	sessionId: string;
	path: string;
	contents: string;
	row?: RemoteConfigSessionMetadataRow;
}

export interface RemoteConfigSessionMessagesArtifactUploader {
	uploadMessagesFile(
		input: RemoteConfigSessionMessagesUploadInput,
	): Promise<void>;
}

export const REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY =
	"enterprise.blobUpload";

const sessionBlobStoreSettings = new Map<
	string,
	RemoteConfigBlobStoreSettings
>();

function accessSettingsToBlobStorage(
	adapterType: RemoteConfigBlobStoreSettings["adapterType"],
	settings: S3AccessKeySettings,
): RemoteConfigBlobStoreSettings {
	return {
		adapterType,
		accessKeyId: settings.accessKeyId,
		secretAccessKey: settings.secretAccessKey,
		region: settings.region,
		bucket: settings.bucket,
		endpoint: settings.endpoint,
		accountId: settings.accountId,
	};
}

function sanitizeBlobStoreTarget(
	settings: RemoteConfigBlobStoreSettings,
): RemoteConfigBlobStoreTarget {
	return {
		adapterType: settings.adapterType,
		bucket: settings.bucket,
		region: settings.region,
		endpoint: settings.endpoint,
		accountId: settings.accountId,
	};
}

export function resolveBlobStoreSettingsFromPromptUploading(
	promptUploading: PromptUploading | undefined,
): RemoteConfigBlobStoreSettings | undefined {
	if (!promptUploading || promptUploading.enabled !== true) {
		return undefined;
	}
	if (
		promptUploading.type === "s3_access_keys" &&
		promptUploading.s3AccessSettings
	) {
		return accessSettingsToBlobStorage("s3", promptUploading.s3AccessSettings);
	}
	if (
		promptUploading.type === "r2_access_keys" &&
		promptUploading.r2AccessSettings
	) {
		return accessSettingsToBlobStorage("r2", promptUploading.r2AccessSettings);
	}
	if (
		promptUploading.type === "azure_access_keys" &&
		promptUploading.azureAccessSettings
	) {
		return accessSettingsToBlobStorage(
			"azure",
			promptUploading.azureAccessSettings,
		);
	}
	return undefined;
}

export function resolveBlobStoreSettingsFromRemoteConfig(
	remoteConfig: RemoteConfig | undefined,
): RemoteConfigBlobStoreSettings | undefined {
	return resolveBlobStoreSettingsFromPromptUploading(
		remoteConfig?.enterpriseTelemetry?.promptUploading,
	);
}

export function buildRemoteConfigSessionBlobUploadMetadata(
	remoteConfig: RemoteConfig | undefined,
	userDistinctId?: string,
): RemoteConfigSessionBlobUploadMetadata | undefined {
	const storage = resolveBlobStoreSettingsFromRemoteConfig(remoteConfig);
	if (!storage) {
		return undefined;
	}
	return {
		version: 1,
		storage: sanitizeBlobStoreTarget(storage),
		userDistinctId,
	};
}

export function registerRemoteConfigSessionBlobUpload(
	sessionId: string,
	remoteConfig: RemoteConfig | undefined,
	userDistinctId?: string,
): RemoteConfigSessionBlobUploadMetadata | undefined {
	const storage = resolveBlobStoreSettingsFromRemoteConfig(remoteConfig);
	if (!storage) {
		sessionBlobStoreSettings.delete(sessionId);
		return undefined;
	}
	sessionBlobStoreSettings.set(sessionId, storage);
	return {
		version: 1,
		storage: sanitizeBlobStoreTarget(storage),
		userDistinctId,
	};
}

export function clearRemoteConfigSessionBlobUpload(sessionId: string): void {
	sessionBlobStoreSettings.delete(sessionId);
}

function createAdapter(
	client: AwsClient,
	endpoint: string,
	bucket: string,
): RemoteConfigBlobStorageAdapter {
	const base = `${endpoint}/${bucket}`;
	return {
		async write(path: string, value: string): Promise<void> {
			const response = await client.fetch(`${base}/${path}`, {
				method: "PUT",
				body: value,
				headers: {
					"Content-Type": "application/json; charset=utf-8",
				},
			});
			if (!response.ok) {
				throw new Error(`Failed to write ${path}: ${response.status}`);
			}
		},
	};
}

function createS3Adapter(
	settings: RemoteConfigBlobStoreSettings,
): RemoteConfigBlobStorageAdapter | undefined {
	const { bucket, accessKeyId, secretAccessKey } = settings;
	if (!bucket || !accessKeyId || !secretAccessKey) {
		return undefined;
	}
	const region = settings.region || "us-east-1";
	const endpoint = settings.endpoint || `https://s3.${region}.amazonaws.com`;
	return createAdapter(
		new AwsClient({
			region,
			accessKeyId,
			secretAccessKey,
		}),
		endpoint,
		bucket,
	);
}

function createR2Adapter(
	settings: RemoteConfigBlobStoreSettings,
): RemoteConfigBlobStorageAdapter | undefined {
	const { accountId, endpoint, bucket, accessKeyId, secretAccessKey } =
		settings;
	if (
		(!endpoint && !accountId) ||
		!bucket ||
		!accessKeyId ||
		!secretAccessKey
	) {
		return undefined;
	}
	return createAdapter(
		new AwsClient({
			accessKeyId,
			secretAccessKey,
		}),
		settings.endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`,
		bucket,
	);
}

function azureSharedKeyAuth(
	accountName: string,
	accountKey: string,
	method: string,
	path: string,
	headers: Record<string, string>,
): string {
	const contentLength = headers["Content-Length"] || "";
	const contentType = headers["Content-Type"] || "";
	const msHeaders = Object.entries(headers)
		.filter(([key]) => key.toLowerCase().startsWith("x-ms-"))
		.sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
		.map(([key, value]) => `${key.toLowerCase()}:${value}`)
		.join("\n");
	const canonicalizedResource = `/${accountName}${path}`;
	const stringToSign = [
		method,
		"",
		"",
		contentLength,
		"",
		contentType,
		"",
		"",
		"",
		"",
		"",
		"",
		msHeaders,
		canonicalizedResource,
	].join("\n");
	const key = Buffer.from(accountKey, "base64");
	const signature = createHmac("sha256", key)
		.update(stringToSign, "utf8")
		.digest("base64");
	return `SharedKey ${accountName}:${signature}`;
}

function createAzureAdapter(
	settings: RemoteConfigBlobStoreSettings,
): RemoteConfigBlobStorageAdapter | undefined {
	const { accessKeyId, secretAccessKey, bucket } = settings;
	if (!accessKeyId || !secretAccessKey || !bucket) {
		return undefined;
	}
	const baseUrl =
		settings.endpoint || `https://${accessKeyId}.blob.core.windows.net`;
	return {
		async write(path: string, value: string): Promise<void> {
			const blobPath = `/${bucket}/${path}`;
			const date = new Date().toUTCString();
			const bodyBuffer = Buffer.from(value, "utf8");
			const headers: Record<string, string> = {
				"x-ms-date": date,
				"x-ms-version": "2024-11-04",
				"x-ms-blob-type": "BlockBlob",
				"Content-Type": "application/json; charset=utf-8",
				"Content-Length": bodyBuffer.byteLength.toString(),
			};
			headers.Authorization = azureSharedKeyAuth(
				accessKeyId,
				secretAccessKey,
				"PUT",
				blobPath,
				headers,
			);

			const response = await fetch(`${baseUrl}${blobPath}`, {
				method: "PUT",
				body: bodyBuffer,
				headers,
			});
			if (!response.ok) {
				const errorBody = await response.text().catch(() => "");
				throw new Error(
					`Failed to write ${path}: ${response.status} ${errorBody}`.trim(),
				);
			}
		},
	};
}

export function createRemoteConfigBlobStorageAdapter(
	settings: RemoteConfigBlobStoreSettings,
): RemoteConfigBlobStorageAdapter | undefined {
	if (settings.adapterType === "s3") {
		return createS3Adapter(settings);
	}
	if (settings.adapterType === "r2") {
		return createR2Adapter(settings);
	}
	if (settings.adapterType === "azure") {
		return createAzureAdapter(settings);
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readRemoteConfigSessionBlobUploadMetadata(
	row: RemoteConfigSessionMetadataRow | undefined,
): RemoteConfigSessionBlobUploadMetadata | undefined {
	const raw = row?.metadata?.[REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY];
	if (!isRecord(raw)) {
		return undefined;
	}
	const storage = raw.storage;
	if (!isRecord(storage)) {
		return undefined;
	}
	const adapterType = storage.adapterType;
	if (adapterType !== "s3" && adapterType !== "r2" && adapterType !== "azure") {
		return undefined;
	}
	if (typeof storage.bucket !== "string") {
		return undefined;
	}
	return {
		version: 1,
		storage: {
			adapterType,
			bucket: storage.bucket,
			region: typeof storage.region === "string" ? storage.region : undefined,
			endpoint:
				typeof storage.endpoint === "string" ? storage.endpoint : undefined,
			accountId:
				typeof storage.accountId === "string" ? storage.accountId : undefined,
		},
		keyPrefix: typeof raw.keyPrefix === "string" ? raw.keyPrefix : undefined,
		userDistinctId:
			typeof raw.userDistinctId === "string" ? raw.userDistinctId : undefined,
	};
}

function buildBlobObjectKey(
	sessionId: string,
	messagesPath: string,
	metadata: RemoteConfigSessionBlobUploadMetadata,
): string {
	const userDistinctId = metadata.userDistinctId?.trim() || "unknown";
	const parts = [
		"sessions",
		userDistinctId,
		sessionId,
		messagesPath?.endsWith("messages.json")
			? "messages.json"
			: basename(messagesPath),
	].filter((value): value is string => Boolean(value?.trim()));
	return parts.join("/");
}

export function createRemoteConfigSessionMessagesArtifactUploader(): RemoteConfigSessionMessagesArtifactUploader {
	const adapters = new Map<string, RemoteConfigBlobStorageAdapter>();
	return {
		async uploadMessagesFile({
			sessionId,
			path,
			contents,
			row,
		}): Promise<void> {
			const metadata = readRemoteConfigSessionBlobUploadMetadata(row);
			if (!metadata) {
				return;
			}
			const settings = sessionBlobStoreSettings.get(sessionId);
			if (!settings) {
				return;
			}
			const cacheKey = JSON.stringify(settings);
			let adapter = adapters.get(cacheKey);
			if (!adapter) {
				adapter = createRemoteConfigBlobStorageAdapter(settings);
				if (!adapter) {
					return;
				}
				adapters.set(cacheKey, adapter);
			}
			await adapter.write(
				buildBlobObjectKey(sessionId, path, metadata),
				contents,
			);
		},
	};
}
