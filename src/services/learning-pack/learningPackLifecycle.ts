import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { compare, minVersion, prerelease } from "semver"
import type { LearningPackArchiveInspection } from "./inspectLearningPackArchive"
import {
	acquirePackLock,
	atomicWriteJson,
	learningPackStoragePaths,
	packLockPath,
	pathExists,
	readJsonFile,
} from "./lifecycleStorage"
import { loadTrustedPublishers, saveTrustedPublishers } from "./trustStore"
import type { LearningPackEdition, VerifiedLearningPackContract } from "./types"
import { validateLearningPackFiles } from "./validateLearningPack"

const REGISTRY_LOCK_ID = "__learning-pack-registry__"

export const LEARNING_PACK_JOURNAL_STATES = [
	"preflight",
	"staged",
	"verified",
	"registry-prepared",
	"activated",
	"committed",
	"cleanup-complete",
] as const

export type LearningPackJournalState = (typeof LEARNING_PACK_JOURNAL_STATES)[number]
export type LearningPackApproval = "cancel" | "install-once" | "trust-publisher"
export type LearningPackOperation = "install" | "rollback" | "remove"

export interface InstalledLearningPackVersion {
	readonly packId: string
	readonly courseId: string
	readonly moduleIds: readonly string[]
	readonly version: string
	readonly edition: LearningPackEdition
	readonly archiveSha256: string
	readonly signerFingerprint: string
	readonly relativePath: string
	readonly installedAt: number
}

export interface InstalledLearningPackRecord {
	readonly active: InstalledLearningPackVersion
	readonly predecessor?: InstalledLearningPackVersion
}

export interface LearningPackRegistry {
	readonly schemaVersion: 1
	readonly packs: Readonly<Record<string, InstalledLearningPackRecord>>
}

export interface LegacyOwnership {
	readonly courseIds?: ReadonlySet<string>
	readonly moduleIds?: ReadonlySet<string>
}

export interface LearningPackLifecycleOptions {
	readonly now?: () => number
	readonly transactionId?: () => string
	readonly prereleaseOptIn?: boolean
	readonly legacyOwnership?: LegacyOwnership
	readonly faultAfterState?: LearningPackJournalState
}

export interface LearningPackLifecycleResult {
	readonly status: "installed" | "rolled-back" | "removed" | "cancelled" | "busy" | "noop" | "rejected" | "failed"
	readonly message?: string
	readonly active?: InstalledLearningPackVersion
}

interface TransactionJournal {
	readonly schemaVersion: 1
	readonly transactionId: string
	readonly packId: string
	readonly operation: LearningPackOperation
	state: LearningPackJournalState
	readonly createdAt: number
	updatedAt: number
	readonly priorRegistry: LearningPackRegistry
	readonly nextRegistry: LearningPackRegistry
	readonly trustBefore: readonly string[]
	readonly trustAfter: readonly string[]
	readonly stagingPath?: string
	readonly activationPath?: string
	readonly obsoletePaths: readonly string[]
}

export class SimulatedLearningPackCrash extends Error {}

function emptyRegistry(): LearningPackRegistry {
	return { schemaVersion: 1, packs: {} }
}

export async function loadLearningPackRegistry(root: string): Promise<LearningPackRegistry> {
	const registry = await readJsonFile<LearningPackRegistry>(learningPackStoragePaths(root).registry, emptyRegistry())
	if (registry.schemaVersion !== 1 || !registry.packs || typeof registry.packs !== "object") {
		throw new Error("Invalid Learning Pack registry")
	}
	return registry
}

function relativeVersionPath(packId: string, archiveSha256: string): string {
	return path.posix.join("packs", packId, "versions", archiveSha256)
}

function absoluteStoragePath(root: string, relativePath: string): string {
	const storageRoot = learningPackStoragePaths(root).root
	const resolved = path.resolve(storageRoot, ...relativePath.split("/"))
	if (resolved !== storageRoot && !resolved.startsWith(`${storageRoot}${path.sep}`)) {
		throw new Error("Learning Pack state path escapes its storage root")
	}
	return resolved
}

function assertPackId(packId: string): void {
	if (!/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/.test(packId)) throw new Error("Invalid Learning Pack ID")
}

function transactionPaths(
	root: string,
	packId: string,
	transactionId: string,
): {
	directory: string
	journal: string
	staging: string
} {
	const storage = learningPackStoragePaths(root)
	return {
		directory: path.join(storage.transactions, packId, transactionId),
		journal: path.join(storage.transactions, packId, transactionId, "journal.json"),
		staging: path.join(storage.packs, packId, ".staging", transactionId),
	}
}

async function saveJournal(filePath: string, journal: TransactionJournal): Promise<void> {
	await atomicWriteJson(filePath, journal)
}

async function advanceJournal(
	filePath: string,
	journal: TransactionJournal,
	state: LearningPackJournalState,
	now: number,
	faultAfterState?: LearningPackJournalState,
): Promise<void> {
	journal.state = state
	journal.updatedAt = now
	await saveJournal(filePath, journal)
	if (faultAfterState === state) throw new SimulatedLearningPackCrash(`Simulated crash after ${state}`)
}

function copiedRegistry(registry: LearningPackRegistry): LearningPackRegistry {
	return JSON.parse(JSON.stringify(registry)) as LearningPackRegistry
}

function assertNoOwnershipCollision(
	registry: LearningPackRegistry,
	contract: VerifiedLearningPackContract,
	legacy: LegacyOwnership | undefined,
): void {
	const manifest = contract.manifest
	const existingPack = registry.packs[manifest.packId]
	if (existingPack && existingPack.active.courseId !== manifest.ownership.courseId) {
		throw new Error("An upgrade cannot change its owned course ID")
	}
	if (legacy?.courseIds?.has(manifest.ownership.courseId)) throw new Error("Course ID collides with legacy content")
	for (const moduleId of manifest.ownership.moduleIds) {
		if (legacy?.moduleIds?.has(moduleId)) throw new Error(`Module ID ${moduleId} collides with legacy content`)
	}
	for (const [ownerPackId, record] of Object.entries(registry.packs)) {
		if (ownerPackId === manifest.packId) continue
		for (const version of [record.active, record.predecessor].filter(Boolean) as InstalledLearningPackVersion[]) {
			if (version.courseId === manifest.ownership.courseId) throw new Error(`Course ID is owned by pack ${ownerPackId}`)
			for (const moduleId of manifest.ownership.moduleIds) {
				if (version.moduleIds.includes(moduleId)) throw new Error(`Module ID ${moduleId} is owned by pack ${ownerPackId}`)
			}
		}
	}
}

function assertInstallVersion(
	current: InstalledLearningPackVersion | undefined,
	target: InstalledLearningPackVersion,
	prereleaseOptIn: boolean,
): "install" | "noop" {
	if (prerelease(target.version) !== null && !prereleaseOptIn)
		throw new Error("Prerelease installation requires explicit opt-in")
	if (!current) return "install"
	const precedence = compare(target.version, current.version)
	if (precedence < 0) throw new Error("Direct downgrade is forbidden; use rollback")
	if (precedence === 0 && target.edition === current.edition) {
		if (target.archiveSha256 === current.archiveSha256) return "noop"
		throw new Error("Same-precedence content differs from the active installation")
	}
	return "install"
}

async function writeInspection(staging: string, inspection: LearningPackArchiveInspection): Promise<void> {
	await fs.mkdir(staging, { recursive: true })
	for (const [relativePath, bytes] of inspection.files) {
		const destination = path.join(staging, ...relativePath.split("/"))
		await fs.mkdir(path.dirname(destination), { recursive: true })
		await fs.writeFile(destination, bytes, { flag: "wx", mode: 0o600 })
	}
}

async function verifyStaging(staging: string, contract: VerifiedLearningPackContract): Promise<void> {
	const files = new Map<string, Uint8Array>()
	for (const entry of contract.checksums.files)
		files.set(entry.path, await fs.readFile(path.join(staging, ...entry.path.split("/"))))
	for (const required of ["checksums.json", "signatures/ed25519.json"]) {
		files.set(required, await fs.readFile(path.join(staging, ...required.split("/"))))
	}
	const compatibleVersion = minVersion(contract.manifest.compatibility.aiHydro)?.version
	if (!compatibleVersion) throw new Error("Pack compatibility range has no satisfiable version")
	const verified = validateLearningPackFiles(files, { aiHydroVersion: compatibleVersion })
	if (verified.status !== "valid" || verified.verified?.signerFingerprint !== contract.signerFingerprint) {
		throw new Error("Staged Learning Pack verification failed")
	}
}

async function applyCommittedState(root: string, journal: TransactionJournal): Promise<void> {
	await atomicWriteJson(learningPackStoragePaths(root).registry, journal.nextRegistry)
	await saveTrustedPublishers(root, journal.trustAfter)
}

async function restorePriorState(root: string, journal: TransactionJournal): Promise<void> {
	await atomicWriteJson(learningPackStoragePaths(root).registry, journal.priorRegistry)
	await saveTrustedPublishers(root, journal.trustBefore)
	if (journal.activationPath) await fs.rm(absoluteStoragePath(root, journal.activationPath), { recursive: true, force: true })
}

async function cleanupJournalFiles(root: string, journal: TransactionJournal, directory: string): Promise<void> {
	for (const obsolete of journal.obsoletePaths)
		await fs.rm(absoluteStoragePath(root, obsolete), { recursive: true, force: true })
	if (journal.stagingPath) await fs.rm(absoluteStoragePath(root, journal.stagingPath), { recursive: true, force: true })
	await fs.rm(directory, { recursive: true, force: true })
}

export async function recoverLearningPackTransactions(root: string, packId?: string): Promise<number> {
	const base = learningPackStoragePaths(root).transactions
	let packIds: string[]
	try {
		packIds = packId ? [packId] : await fs.readdir(base)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0
		throw error
	}
	const registryLock = await acquirePackLock(root, REGISTRY_LOCK_ID)
	if (!registryLock) return 0
	let recovered = 0
	try {
		for (const currentPackId of packIds) {
			const lock = await acquirePackLock(root, currentPackId)
			if (!lock) continue
			try {
				const packTransactions = path.join(base, currentPackId)
				let transactionIds: string[]
				try {
					transactionIds = await fs.readdir(packTransactions)
				} catch {
					continue
				}
				for (const transactionId of transactionIds.sort()) {
					const directory = path.join(packTransactions, transactionId)
					const journal = await readJsonFile<TransactionJournal | null>(path.join(directory, "journal.json"), null)
					if (!journal) {
						await fs.rm(directory, { recursive: true, force: true })
						continue
					}
					const committed = journal.state === "committed" || journal.state === "cleanup-complete"
					if (committed) await applyCommittedState(root, journal)
					else await restorePriorState(root, journal)
					await cleanupJournalFiles(root, journal, directory)
					recovered++
				}
			} finally {
				await lock.release()
			}
		}
	} finally {
		await registryLock.release()
	}
	return recovered
}

function lifecycleResult(status: LearningPackLifecycleResult["status"], message?: string, active?: InstalledLearningPackVersion) {
	return Object.freeze({ status, message, active })
}

export async function installLearningPack(
	root: string,
	inspection: LearningPackArchiveInspection,
	approval: LearningPackApproval,
	options: LearningPackLifecycleOptions = {},
): Promise<LearningPackLifecycleResult> {
	if (approval === "cancel") return lifecycleResult("cancelled")
	const manifest = inspection.contract.manifest
	const now = options.now?.() ?? Date.now()
	await recoverLearningPackTransactions(root, manifest.packId)
	const registryLock = await acquirePackLock(root, REGISTRY_LOCK_ID, now)
	if (!registryLock) return lifecycleResult("busy", "Learning Pack registry is busy")
	const lock = await acquirePackLock(root, manifest.packId, now)
	if (!lock) {
		await registryLock.release()
		return lifecycleResult("busy", `Pack ${manifest.packId} is busy`)
	}
	let journal: TransactionJournal | undefined
	let journalDirectory: string | undefined
	try {
		const priorRegistry = await loadLearningPackRegistry(root)
		assertNoOwnershipCollision(priorRegistry, inspection.contract, options.legacyOwnership)
		const trustBefore = await loadTrustedPublishers(root)
		const transactionId = options.transactionId?.() ?? `${now}-${process.pid}-${randomUUID()}`
		if (!/^[a-zA-Z0-9._-]+$/.test(transactionId)) throw new Error("Invalid transaction ID")
		const paths = transactionPaths(root, manifest.packId, transactionId)
		journalDirectory = paths.directory
		const activationPath = relativeVersionPath(manifest.packId, inspection.archiveSha256)
		const active: InstalledLearningPackVersion = Object.freeze({
			packId: manifest.packId,
			courseId: manifest.ownership.courseId,
			moduleIds: Object.freeze([...manifest.ownership.moduleIds]),
			version: manifest.version,
			edition: manifest.edition,
			archiveSha256: inspection.archiveSha256,
			signerFingerprint: inspection.contract.signerFingerprint,
			relativePath: activationPath,
			installedAt: now,
		})
		if (
			assertInstallVersion(priorRegistry.packs[manifest.packId]?.active, active, options.prereleaseOptIn ?? false) ===
			"noop"
		) {
			return lifecycleResult("noop", undefined, priorRegistry.packs[manifest.packId].active)
		}
		if (await pathExists(absoluteStoragePath(root, activationPath)))
			throw new Error("Target installation path already exists")
		const nextRegistry = copiedRegistry(priorRegistry)
		const previous = priorRegistry.packs[manifest.packId]
		;(nextRegistry.packs as Record<string, InstalledLearningPackRecord>)[manifest.packId] = {
			active,
			predecessor: previous?.active,
		}
		const trustAfter =
			approval === "trust-publisher"
				? [...new Set([...trustBefore.fingerprints, inspection.contract.signerFingerprint])].sort()
				: [...trustBefore.fingerprints]
		journal = {
			schemaVersion: 1,
			transactionId,
			packId: manifest.packId,
			operation: "install",
			state: "preflight",
			createdAt: now,
			updatedAt: now,
			priorRegistry,
			nextRegistry,
			trustBefore: trustBefore.fingerprints,
			trustAfter,
			stagingPath: path.relative(learningPackStoragePaths(root).root, paths.staging).split(path.sep).join("/"),
			activationPath,
			obsoletePaths: previous?.predecessor ? [previous.predecessor.relativePath] : [],
		}
		await fs.mkdir(paths.directory, { recursive: true })
		await advanceJournal(paths.journal, journal, "preflight", now, options.faultAfterState)
		await writeInspection(paths.staging, inspection)
		await advanceJournal(paths.journal, journal, "staged", now, options.faultAfterState)
		await verifyStaging(paths.staging, inspection.contract)
		await advanceJournal(paths.journal, journal, "verified", now, options.faultAfterState)
		await atomicWriteJson(path.join(paths.directory, "registry.next.json"), nextRegistry)
		await advanceJournal(paths.journal, journal, "registry-prepared", now, options.faultAfterState)
		await fs.mkdir(path.dirname(absoluteStoragePath(root, activationPath)), { recursive: true })
		await fs.rename(paths.staging, absoluteStoragePath(root, activationPath))
		await advanceJournal(paths.journal, journal, "activated", now, options.faultAfterState)
		await applyCommittedState(root, journal)
		await advanceJournal(paths.journal, journal, "committed", now, options.faultAfterState)
		for (const obsolete of journal.obsoletePaths)
			await fs.rm(absoluteStoragePath(root, obsolete), { recursive: true, force: true })
		await advanceJournal(paths.journal, journal, "cleanup-complete", now, options.faultAfterState)
		await fs.rm(paths.directory, { recursive: true, force: true })
		return lifecycleResult("installed", undefined, active)
	} catch (error) {
		if (error instanceof SimulatedLearningPackCrash) throw error
		if (journal && journalDirectory) {
			const committed = journal.state === "committed" || journal.state === "cleanup-complete"
			if (committed) await applyCommittedState(root, journal)
			else await restorePriorState(root, journal)
			await cleanupJournalFiles(root, journal, journalDirectory)
		}
		return lifecycleResult("rejected", error instanceof Error ? error.message : String(error))
	} finally {
		await lock.release()
		await registryLock.release()
	}
}

async function transitionInstalledPack(
	root: string,
	packId: string,
	operation: "rollback" | "remove",
	options: LearningPackLifecycleOptions,
): Promise<LearningPackLifecycleResult> {
	const now = options.now?.() ?? Date.now()
	await recoverLearningPackTransactions(root, packId)
	const registryLock = await acquirePackLock(root, REGISTRY_LOCK_ID, now)
	if (!registryLock) return lifecycleResult("busy", "Learning Pack registry is busy")
	const lock = await acquirePackLock(root, packId, now)
	if (!lock) {
		await registryLock.release()
		return lifecycleResult("busy", `Pack ${packId} is busy`)
	}
	let journal: TransactionJournal | undefined
	let journalDirectory: string | undefined
	try {
		const priorRegistry = await loadLearningPackRegistry(root)
		const current = priorRegistry.packs[packId]
		if (!current) return lifecycleResult("rejected", `Pack ${packId} is not installed`)
		if (operation === "rollback" && !current.predecessor) {
			return lifecycleResult("rejected", `Pack ${packId} has no verified predecessor`)
		}
		const nextRegistry = copiedRegistry(priorRegistry)
		const mutablePacks = nextRegistry.packs as Record<string, InstalledLearningPackRecord>
		if (operation === "rollback") {
			mutablePacks[packId] = { active: current.predecessor!, predecessor: current.active }
		} else {
			delete mutablePacks[packId]
		}
		const trust = await loadTrustedPublishers(root)
		const transactionId = options.transactionId?.() ?? `${now}-${process.pid}-${randomUUID()}`
		if (!/^[a-zA-Z0-9._-]+$/.test(transactionId)) throw new Error("Invalid transaction ID")
		const paths = transactionPaths(root, packId, transactionId)
		journalDirectory = paths.directory
		journal = {
			schemaVersion: 1,
			transactionId,
			packId,
			operation,
			state: "preflight",
			createdAt: now,
			updatedAt: now,
			priorRegistry,
			nextRegistry,
			trustBefore: trust.fingerprints,
			trustAfter: trust.fingerprints,
			obsoletePaths:
				operation === "remove"
					? ([current.active.relativePath, current.predecessor?.relativePath].filter(Boolean) as string[])
					: [],
		}
		await fs.mkdir(paths.directory, { recursive: true })
		for (const state of ["preflight", "staged", "verified"] as const) {
			await advanceJournal(paths.journal, journal, state, now, options.faultAfterState)
		}
		await atomicWriteJson(path.join(paths.directory, "registry.next.json"), nextRegistry)
		await advanceJournal(paths.journal, journal, "registry-prepared", now, options.faultAfterState)
		await advanceJournal(paths.journal, journal, "activated", now, options.faultAfterState)
		await applyCommittedState(root, journal)
		await advanceJournal(paths.journal, journal, "committed", now, options.faultAfterState)
		for (const obsolete of journal.obsoletePaths)
			await fs.rm(absoluteStoragePath(root, obsolete), { recursive: true, force: true })
		await advanceJournal(paths.journal, journal, "cleanup-complete", now, options.faultAfterState)
		await fs.rm(paths.directory, { recursive: true, force: true })
		const active = operation === "rollback" ? nextRegistry.packs[packId].active : undefined
		return lifecycleResult(operation === "rollback" ? "rolled-back" : "removed", undefined, active)
	} catch (error) {
		if (error instanceof SimulatedLearningPackCrash) throw error
		if (journal && journalDirectory) {
			const committed = journal.state === "committed" || journal.state === "cleanup-complete"
			if (committed) await applyCommittedState(root, journal)
			else await restorePriorState(root, journal)
			await cleanupJournalFiles(root, journal, journalDirectory)
		}
		return lifecycleResult("failed", error instanceof Error ? error.message : String(error))
	} finally {
		await lock.release()
		await registryLock.release()
	}
}

export async function rollbackLearningPack(
	root: string,
	packId: string,
	options: LearningPackLifecycleOptions = {},
): Promise<LearningPackLifecycleResult> {
	assertPackId(packId)
	return transitionInstalledPack(root, packId, "rollback", options)
}

export async function removeLearningPack(
	root: string,
	packId: string,
	options: LearningPackLifecycleOptions = {},
): Promise<LearningPackLifecycleResult> {
	assertPackId(packId)
	return transitionInstalledPack(root, packId, "remove", options)
}

export async function cleanupAbandonedLearningPackStaging(root: string, now = Date.now()): Promise<number> {
	const storage = learningPackStoragePaths(root)
	let packIds: string[]
	try {
		packIds = await fs.readdir(storage.packs)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0
		throw error
	}
	let removed = 0
	for (const packId of packIds) {
		if (await pathExists(packLockPath(root, packId))) continue
		const stagingRoot = path.join(storage.packs, packId, ".staging")
		let entries: string[]
		try {
			entries = await fs.readdir(stagingRoot)
		} catch {
			continue
		}
		for (const entry of entries) {
			const candidate = path.join(stagingRoot, entry)
			const stat = await fs.stat(candidate)
			if (now - stat.mtimeMs <= 24 * 60 * 60 * 1000) continue
			await fs.rm(candidate, { recursive: true, force: true })
			removed++
		}
	}
	return removed
}
