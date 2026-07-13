import { strict as assert } from "node:assert"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, it } from "mocha"
import { atomicWriteJson, learningPackStoragePaths } from "../lifecycleStorage"
import type { LearningPackRegistry } from "../learningPackLifecycle"
import {
	learningPackArtifactMetadata,
	learningPackControlsKey,
	learningPackProgressKey,
	resolveActiveLearningPackEntry,
	resolveInstalledLearningPackScope,
} from "../runtimeIntegration"

const roots: string[] = []

async function fixture(): Promise<{ root: string; module: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "aihydro-pack-runtime-"))
	roots.push(root)
	const relativePath = "packs/hmfp/versions/archive-sha"
	const installation = path.join(root, ...relativePath.split("/"))
	const module = path.join(installation, "modules", "water-balance", "module.html")
	await fs.mkdir(path.dirname(module), { recursive: true })
	await fs.writeFile(module, "<!doctype html><title>Water balance</title>", "utf8")
	await atomicWriteJson(path.join(installation, "pack.json"), { entryModuleId: "water-balance" })
	await atomicWriteJson(path.join(installation, "course.json"), {
		courseId: "hydrologic-modeling",
		title: "Hydrologic Modeling",
		modules: [{ id: "water-balance", title: "Water balance", path: "modules/water-balance/module.html" }],
	})
	const registry: LearningPackRegistry = {
		schemaVersion: 1,
		packs: {
			hmfp: {
				active: {
					packId: "hmfp",
					courseId: "hydrologic-modeling",
					moduleIds: ["water-balance"],
					version: "1.0.0",
					edition: "student",
					archiveSha256: "archive-sha",
					signerFingerprint: "sha256:signer",
					relativePath,
					installedAt: 1,
				},
			},
		},
	}
	await atomicWriteJson(learningPackStoragePaths(root).registry, registry)
	return { root, module }
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("Learning Pack runtime integration", () => {
	it("resolves only active installed module paths and publishes neutral metadata", async () => {
		const { root, module } = await fixture()
		const scope = await resolveInstalledLearningPackScope(module, root)
		assert.deepEqual(scope, {
			packId: "hmfp",
			courseId: "hydrologic-modeling",
			edition: "student",
			moduleId: "water-balance",
		})
		assert.equal(learningPackArtifactMetadata(scope!).artifactKind, "learning-pack-v1")
		assert.equal(await resolveInstalledLearningPackScope(path.join(root, "outside.html"), root), null)
	})

	it("isolates progress and controls by pack, course, edition, and module", () => {
		const student = { packId: "hmfp", courseId: "course", edition: "student" as const, moduleId: "one" }
		const instructor = { ...student, edition: "instructor" as const }
		assert.notEqual(learningPackProgressKey(student), learningPackProgressKey(instructor))
		assert.notEqual(learningPackControlsKey(student), learningPackControlsKey(instructor))
		assert.notEqual(learningPackControlsKey(student), learningPackControlsKey({ ...student, moduleId: "two" }))
	})

	it("resolves the active entry from the transactional registry", async () => {
		const { root, module } = await fixture()
		const entry = await resolveActiveLearningPackEntry(root, "hmfp")
		assert.equal(entry.filePath, module)
		assert.equal(entry.scope.moduleId, "water-balance")
	})
})
