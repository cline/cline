import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { learningPackStoragePaths } from "./lifecycleStorage"
import { loadLearningPackRegistry, type InstalledLearningPackVersion } from "./learningPackLifecycle"
import type { LearningPackCourse, LearningPackEdition } from "./types"

export const LEARNING_PACK_ARTIFACT_KIND = "learning-pack-v1"

export interface InstalledLearningPackScope {
	readonly packId: string
	readonly courseId: string
	readonly edition: LearningPackEdition
	readonly moduleId: string
}

export interface InstalledLearningPackArtifact {
	readonly scope: InstalledLearningPackScope
	readonly installationRoot: string
}

export function parseInstalledLearningPackScope(value: unknown): InstalledLearningPackScope | null {
	if (!value || typeof value !== "object") return null
	const candidate = value as Record<string, unknown>
	if (
		typeof candidate.packId !== "string" ||
		typeof candidate.courseId !== "string" ||
		typeof candidate.moduleId !== "string" ||
		(candidate.edition !== "student" && candidate.edition !== "instructor")
	) {
		return null
	}
	return {
		packId: candidate.packId,
		courseId: candidate.courseId,
		edition: candidate.edition,
		moduleId: candidate.moduleId,
	}
}

export function defaultLearningPackRoot(): string {
	return process.env.AIHYDRO_LEARNING_PACK_ROOT || path.join(os.homedir(), ".aihydro", "learning-packs")
}

function containedBy(candidate: string, parent: string): boolean {
	const relative = path.relative(parent, candidate)
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function activeRoot(root: string, active: InstalledLearningPackVersion): string {
	return path.resolve(learningPackStoragePaths(root).root, ...active.relativePath.split("/"))
}

export async function resolveInstalledLearningPackArtifact(
	filePath: string,
	root = defaultLearningPackRoot(),
): Promise<InstalledLearningPackArtifact | null> {
	const resolvedFile = path.resolve(filePath)
	let registry
	try {
		registry = await loadLearningPackRegistry(root)
	} catch {
		return null
	}
	for (const [packId, record] of Object.entries(registry.packs)) {
		const installation = activeRoot(root, record.active)
		if (!containedBy(resolvedFile, installation)) continue
		try {
			const course = JSON.parse(await fs.readFile(path.join(installation, "course.json"), "utf8")) as LearningPackCourse
			const module = course.modules.find((entry) => path.resolve(installation, ...entry.path.split("/")) === resolvedFile)
			if (!module) return null
			return Object.freeze({
				installationRoot: installation,
				scope: Object.freeze({
					packId,
					courseId: record.active.courseId,
					edition: record.active.edition,
					moduleId: module.id,
				}),
			})
		} catch {
			return null
		}
	}
	return null
}

export async function resolveInstalledLearningPackScope(
	filePath: string,
	root = defaultLearningPackRoot(),
): Promise<InstalledLearningPackScope | null> {
	return (await resolveInstalledLearningPackArtifact(filePath, root))?.scope ?? null
}

export function learningPackArtifactMetadata(scope: InstalledLearningPackScope): Readonly<Record<string, string>> {
	return Object.freeze({
		artifactKind: LEARNING_PACK_ARTIFACT_KIND,
		learningPackId: scope.packId,
		learningPackCourseId: scope.courseId,
		learningPackEdition: scope.edition,
		learningPackModuleId: scope.moduleId,
	})
}

function scopedKey(kind: "progress" | "controls", values: readonly string[]): string {
	const digest = createHash("sha256").update(JSON.stringify([kind, ...values]), "utf8").digest("hex")
	return `learning-pack-v1-${kind}-${digest}`
}

export function learningPackProgressKey(scope: Pick<InstalledLearningPackScope, "packId" | "courseId" | "edition">): string {
	return scopedKey("progress", [scope.packId, scope.courseId, scope.edition])
}

export function learningPackControlsKey(scope: InstalledLearningPackScope): string {
	return scopedKey("controls", [scope.packId, scope.courseId, scope.edition, scope.moduleId])
}

export async function resolveActiveLearningPackEntry(
	root: string,
	packId: string,
): Promise<{ readonly filePath: string; readonly title: string; readonly scope: InstalledLearningPackScope }> {
	const record = (await loadLearningPackRegistry(root)).packs[packId]
	if (!record) throw new Error(`Pack ${packId} is not installed`)
	const installation = activeRoot(root, record.active)
	const manifest = JSON.parse(await fs.readFile(path.join(installation, "pack.json"), "utf8")) as {
		entryModuleId: string
	}
	const course = JSON.parse(await fs.readFile(path.join(installation, "course.json"), "utf8")) as LearningPackCourse
	const module = course.modules.find((entry) => entry.id === manifest.entryModuleId)
	if (!module) throw new Error(`Pack ${packId} entry module is missing from course.json`)
	return Object.freeze({
		filePath: path.resolve(installation, ...module.path.split("/")),
		title: module.title,
		scope: Object.freeze({
			packId,
			courseId: record.active.courseId,
			edition: record.active.edition,
			moduleId: module.id,
		}),
	})
}
