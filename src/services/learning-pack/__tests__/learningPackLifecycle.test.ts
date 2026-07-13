import { createHash, generateKeyPairSync } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import type { LearningPackArchiveInspection } from "../inspectLearningPackArchive"
import {
	cleanupAbandonedLearningPackStaging,
	installLearningPack,
	LEARNING_PACK_JOURNAL_STATES,
	loadLearningPackRegistry,
	recoverLearningPackTransactions,
	removeLearningPack,
	rollbackLearningPack,
	SimulatedLearningPackCrash,
} from "../learningPackLifecycle"
import { acquirePackLock, pathExists } from "../lifecycleStorage"
import { derivePackTrustState, loadTrustedPublishers, removeTrustedPublisher, saveTrustedPublishers } from "../trustStore"
import { validateLearningPackFiles } from "../validateLearningPack"
import { createValidLearningPackFiles } from "./learningPackTestFixture"

function inspection(options?: Parameters<typeof createValidLearningPackFiles>[0]): LearningPackArchiveInspection {
	const { files } = createValidLearningPackFiles(options)
	const result = validateLearningPackFiles(files, { aiHydroVersion: "0.2.5" })
	if (result.status !== "valid" || !result.verified) throw new Error(JSON.stringify(result.diagnostics))
	const archiveSha256 = createHash("sha256")
	for (const [name, bytes] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
		archiveSha256.update(name).update(bytes)
	}
	return Object.freeze({
		archiveSha256: archiveSha256.digest("hex"),
		compressedBytes: 1,
		totalUncompressedBytes: [...files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0),
		entryCount: files.size,
		files,
		contract: result.verified,
	})
}

describe("Learning Pack transactional lifecycle", () => {
	let temporaryRoot: string
	let root: string

	beforeEach(async () => {
		temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-lifecycle-"))
		root = path.join(temporaryRoot, "learning-packs")
	})

	afterEach(async () => {
		await fs.rm(temporaryRoot, { recursive: true, force: true })
	})

	it("cancels with zero writes and derives signed-untrusted, approved-once, and trusted-publisher locally", async () => {
		const pack = inspection()
		expect((await installLearningPack(root, pack, "cancel")).status).to.equal("cancelled")
		expect(await pathExists(root)).to.equal(false)
		expect(await derivePackTrustState(root, pack)).to.equal("signed-untrusted")
		expect(await derivePackTrustState(root, pack, true)).to.equal("approved-once")

		expect((await installLearningPack(root, pack, "trust-publisher")).status).to.equal("installed")
		expect(await derivePackTrustState(root, pack)).to.equal("trusted-publisher")
		await removeTrustedPublisher(root, pack.contract.signerFingerprint)
		expect(await derivePackTrustState(root, pack)).to.equal("signed-untrusted")
		expect((await loadLearningPackRegistry(root)).packs.hmfp.active.archiveSha256).to.equal(pack.archiveSha256)
	})

	it("installs allowlisted bytes, returns busy under the per-pack lock, and atomically replaces trust JSON", async () => {
		const pack = inspection()
		const held = await acquirePackLock(root, "hmfp")
		expect(held).not.to.equal(null)
		expect((await installLearningPack(root, pack, "install-once")).status).to.equal("busy")
		await held?.release()

		const installed = await installLearningPack(root, pack, "install-once")
		expect(installed.status).to.equal("installed")
		const modulePath = path.join(root, installed.active!.relativePath, "modules/hmfp.water-balance.01/module.html")
		expect(await fs.readFile(modulePath, "utf8")).to.contain("hmfp.water-balance.01")

		await saveTrustedPublishers(root, [`sha256:${"1".repeat(64)}`])
		await saveTrustedPublishers(root, [`sha256:${"2".repeat(64)}`])
		expect((await loadTrustedPublishers(root)).fingerprints).to.deep.equal([`sha256:${"2".repeat(64)}`])
	})

	it("enforces collisions, SemVer precedence, prerelease opt-in, and edition switching", async () => {
		const key = generateKeyPairSync("ed25519").privateKey
		const stable = inspection({ version: "1.0.0", privateKey: key })
		expect((await installLearningPack(root, stable, "install-once")).status).to.equal("installed")
		expect((await installLearningPack(root, stable, "install-once")).status).to.equal("noop")

		const altered = inspection({ version: "1.0.0", privateKey: generateKeyPairSync("ed25519").privateKey })
		expect((await installLearningPack(root, altered, "install-once")).status).to.equal("rejected")
		const alteredBuild = inspection({ version: "1.0.0+different", privateKey: key })
		expect((await installLearningPack(root, alteredBuild, "install-once")).status).to.equal("rejected")
		const downgrade = inspection({ version: "0.9.0", privateKey: key })
		expect((await installLearningPack(root, downgrade, "install-once")).status).to.equal("rejected")

		const instructor = inspection({ version: "1.0.0", edition: "instructor", privateKey: key })
		expect((await installLearningPack(root, instructor, "install-once")).status).to.equal("installed")
		expect((await loadLearningPackRegistry(root)).packs.hmfp.active.edition).to.equal("instructor")

		const collision = inspection({ packId: "other-pack" })
		expect((await installLearningPack(root, collision, "install-once")).status).to.equal("rejected")
		const changedCourse = inspection({ version: "1.1.0", courseId: "other-course", privateKey: key })
		expect((await installLearningPack(root, changedCourse, "install-once")).status).to.equal("rejected")
		const legacyRoot = path.join(temporaryRoot, "legacy-collision")
		expect(
			(
				await installLearningPack(legacyRoot, stable, "install-once", {
					legacyOwnership: { courseIds: new Set(["hmfp"]) },
				})
			).status,
		).to.equal("rejected")

		const prereleaseRoot = path.join(temporaryRoot, "prerelease")
		const prereleasePack = inspection({ version: "1.0.0-beta.1", privateKey: key })
		expect((await installLearningPack(prereleaseRoot, prereleasePack, "install-once")).status).to.equal("rejected")
		expect(
			(await installLearningPack(prereleaseRoot, prereleasePack, "install-once", { prereleaseOptIn: true })).status,
		).to.equal("installed")
		expect((await installLearningPack(prereleaseRoot, stable, "install-once")).status).to.equal("installed")
	})

	for (const state of LEARNING_PACK_JOURNAL_STATES) {
		it(`recovers idempotently from a crash after ${state}`, async () => {
			const pack = inspection()
			let crashed = false
			try {
				await installLearningPack(root, pack, "install-once", {
					faultAfterState: state,
					transactionId: () => `fault-${state}`,
					now: () => 1_700_000_000_000,
				})
			} catch (error) {
				crashed = error instanceof SimulatedLearningPackCrash
			}
			expect(crashed).to.equal(true)
			expect(await recoverLearningPackTransactions(root)).to.equal(1)
			expect(await recoverLearningPackTransactions(root)).to.equal(0)
			const registry = await loadLearningPackRegistry(root)
			const shouldCommit = state === "committed" || state === "cleanup-complete"
			expect(Boolean(registry.packs.hmfp)).to.equal(shouldCommit)
		})
	}

	it("restores the old version for a pre-commit upgrade crash and completes a committed upgrade", async () => {
		const key = generateKeyPairSync("ed25519").privateKey
		const first = inspection({ version: "1.0.0", privateKey: key })
		const second = inspection({ version: "1.1.0", privateKey: key })
		await installLearningPack(root, first, "install-once")
		try {
			await installLearningPack(root, second, "install-once", {
				faultAfterState: "activated",
				transactionId: () => "upgrade-before-commit",
			})
		} catch (error) {
			expect(error).to.be.instanceOf(SimulatedLearningPackCrash)
		}
		await recoverLearningPackTransactions(root)
		expect((await loadLearningPackRegistry(root)).packs.hmfp.active.version).to.equal("1.0.0")

		try {
			await installLearningPack(root, second, "install-once", {
				faultAfterState: "committed",
				transactionId: () => "upgrade-after-commit",
			})
		} catch (error) {
			expect(error).to.be.instanceOf(SimulatedLearningPackCrash)
		}
		await recoverLearningPackTransactions(root)
		const registry = await loadLearningPackRegistry(root)
		expect(registry.packs.hmfp.active.version).to.equal("1.1.0")
		expect(registry.packs.hmfp.predecessor?.version).to.equal("1.0.0")
	})

	it("retains only the active version and one verified predecessor", async () => {
		const key = generateKeyPairSync("ed25519").privateKey
		const first = await installLearningPack(root, inspection({ version: "1.0.0", privateKey: key }), "install-once")
		await installLearningPack(root, inspection({ version: "1.1.0", privateKey: key }), "install-once")
		await installLearningPack(root, inspection({ version: "1.2.0", privateKey: key }), "install-once")
		const registry = await loadLearningPackRegistry(root)
		expect(registry.packs.hmfp.active.version).to.equal("1.2.0")
		expect(registry.packs.hmfp.predecessor?.version).to.equal("1.1.0")
		expect(await pathExists(path.join(root, first.active!.relativePath))).to.equal(false)
	})

	it("keeps one predecessor, rolls back by swapping versions, and removes only pack-owned files", async () => {
		const key = generateKeyPairSync("ed25519").privateKey
		const first = inspection({ version: "1.0.0", privateKey: key })
		const second = inspection({ version: "1.1.0", privateKey: key })
		await installLearningPack(root, first, "trust-publisher")
		await installLearningPack(root, second, "install-once")
		let registry = await loadLearningPackRegistry(root)
		expect(registry.packs.hmfp.predecessor?.version).to.equal("1.0.0")

		expect((await rollbackLearningPack(root, "hmfp")).status).to.equal("rolled-back")
		registry = await loadLearningPackRegistry(root)
		expect(registry.packs.hmfp.active.version).to.equal("1.0.0")
		expect(registry.packs.hmfp.predecessor?.version).to.equal("1.1.0")

		const progress = path.join(temporaryRoot, "course_progress", "hmfp.json")
		const controls = path.join(temporaryRoot, "module_state", "hmfp.json")
		await fs.mkdir(path.dirname(progress), { recursive: true })
		await fs.mkdir(path.dirname(controls), { recursive: true })
		await fs.writeFile(progress, "progress")
		await fs.writeFile(controls, "controls")
		expect((await removeLearningPack(root, "hmfp")).status).to.equal("removed")
		expect((await loadLearningPackRegistry(root)).packs.hmfp).to.equal(undefined)
		expect(await fs.readFile(progress, "utf8")).to.equal("progress")
		expect(await fs.readFile(controls, "utf8")).to.equal("controls")
		expect((await loadTrustedPublishers(root)).fingerprints).to.include(first.contract.signerFingerprint)
	})

	it("recovers rollback and removal on the correct side of the commit boundary", async () => {
		const key = generateKeyPairSync("ed25519").privateKey
		await installLearningPack(root, inspection({ version: "1.0.0", privateKey: key }), "install-once")
		await installLearningPack(root, inspection({ version: "1.1.0", privateKey: key }), "install-once")
		try {
			await rollbackLearningPack(root, "hmfp", {
				faultAfterState: "activated",
				transactionId: () => "rollback-before-commit",
			})
		} catch (error) {
			expect(error).to.be.instanceOf(SimulatedLearningPackCrash)
		}
		await recoverLearningPackTransactions(root)
		expect((await loadLearningPackRegistry(root)).packs.hmfp.active.version).to.equal("1.1.0")

		try {
			await rollbackLearningPack(root, "hmfp", {
				faultAfterState: "committed",
				transactionId: () => "rollback-after-commit",
			})
		} catch (error) {
			expect(error).to.be.instanceOf(SimulatedLearningPackCrash)
		}
		await recoverLearningPackTransactions(root)
		expect((await loadLearningPackRegistry(root)).packs.hmfp.active.version).to.equal("1.0.0")

		try {
			await removeLearningPack(root, "hmfp", {
				faultAfterState: "activated",
				transactionId: () => "remove-before-commit",
			})
		} catch (error) {
			expect(error).to.be.instanceOf(SimulatedLearningPackCrash)
		}
		await recoverLearningPackTransactions(root)
		expect((await loadLearningPackRegistry(root)).packs.hmfp).not.to.equal(undefined)

		try {
			await removeLearningPack(root, "hmfp", {
				faultAfterState: "committed",
				transactionId: () => "remove-after-commit",
			})
		} catch (error) {
			expect(error).to.be.instanceOf(SimulatedLearningPackCrash)
		}
		await recoverLearningPackTransactions(root)
		expect((await loadLearningPackRegistry(root)).packs.hmfp).to.equal(undefined)
	})

	it("removes abandoned staging after 24 hours but skips a locked pack", async () => {
		const old = 1_700_000_000_000
		const staging = path.join(root, "packs", "hmfp", ".staging", "abandoned")
		await fs.mkdir(staging, { recursive: true })
		await fs.utimes(staging, new Date(old), new Date(old))
		const lock = await acquirePackLock(root, "hmfp", old + 25 * 60 * 60 * 1000)
		expect(await cleanupAbandonedLearningPackStaging(root, old + 25 * 60 * 60 * 1000)).to.equal(0)
		await lock?.release()
		expect(await cleanupAbandonedLearningPackStaging(root, old + 25 * 60 * 60 * 1000)).to.equal(1)
	})
})
