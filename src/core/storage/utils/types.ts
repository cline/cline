import { type SecretStorage } from "vscode"
import { CredentialStorage } from "../credential"
import { ClineSecretStorageType } from "../secrets"
import { ClineStorage } from "../stateless"

export type ClineStorages = ClineStorage | ClineSecretStorageType | CredentialStorage | SecretStorage

export interface ClineStorageChangeEvent {
	readonly key: string
}

export type StorageEventListener = (event: ClineStorageChangeEvent) => Promise<void>
