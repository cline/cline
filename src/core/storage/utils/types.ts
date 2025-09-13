import { type SecretStorage } from "vscode"
import { ClineStorage } from "../ClineStorage"
import { CredentialStorage } from "../credential"
import { ClineSecretStorage } from "../secrets"

export type ClineStorages = ClineStorage | ClineSecretStorage | CredentialStorage | SecretStorage

export interface ClineStorageChangeEvent {
	readonly key: string
}

export type StorageEventListener = (event: ClineStorageChangeEvent) => Promise<void>
