import { atomicWriteJson, learningPackStoragePaths, readJsonFile } from "./lifecycleStorage"
import type { LearningPackArchiveInspection } from "./inspectLearningPackArchive"

const FINGERPRINT = /^sha256:[0-9a-f]{64}$/

export interface TrustedPublisherStore {
	readonly schemaVersion: 1
	readonly fingerprints: readonly string[]
}

function normalize(fingerprints: readonly string[]): TrustedPublisherStore {
	for (const fingerprint of fingerprints) {
		if (!FINGERPRINT.test(fingerprint)) throw new Error(`Invalid Ed25519 fingerprint ${fingerprint}`)
	}
	return Object.freeze({ schemaVersion: 1, fingerprints: Object.freeze([...new Set(fingerprints)].sort()) })
}

export async function loadTrustedPublishers(root: string): Promise<TrustedPublisherStore> {
	const value = await readJsonFile<{ schemaVersion?: unknown; fingerprints?: unknown }>(learningPackStoragePaths(root).trust, {
		schemaVersion: 1,
		fingerprints: [],
	})
	if (value.schemaVersion !== 1 || !Array.isArray(value.fingerprints)) throw new Error("Invalid trusted-publisher store")
	return normalize(value.fingerprints as string[])
}

export async function saveTrustedPublishers(root: string, fingerprints: readonly string[]): Promise<TrustedPublisherStore> {
	const normalized = normalize(fingerprints)
	await atomicWriteJson(learningPackStoragePaths(root).trust, normalized)
	return normalized
}

export async function trustPublisher(root: string, fingerprint: string): Promise<TrustedPublisherStore> {
	const current = await loadTrustedPublishers(root)
	return saveTrustedPublishers(root, [...current.fingerprints, fingerprint])
}

export async function removeTrustedPublisher(root: string, fingerprint: string): Promise<TrustedPublisherStore> {
	const current = await loadTrustedPublishers(root)
	return saveTrustedPublishers(
		root,
		current.fingerprints.filter((value) => value !== fingerprint),
	)
}

export type InstalledPackTrustState = "signed-untrusted" | "approved-once" | "trusted-publisher"

export async function derivePackTrustState(
	root: string,
	inspection: LearningPackArchiveInspection,
	approvedOnce = false,
): Promise<InstalledPackTrustState> {
	const trusted = await loadTrustedPublishers(root)
	if (trusted.fingerprints.includes(inspection.contract.signerFingerprint)) return "trusted-publisher"
	return approvedOnce ? "approved-once" : "signed-untrusted"
}
