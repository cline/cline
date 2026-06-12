/**
 * Install registries for the learning hub — extension-host side.
 *
 * Two JSON files under ~/.aihydro track what the learner has installed and at
 * which version, so the marketplace can show "Installed" and "Update available"
 * without a network round-trip:
 *
 *   ~/.aihydro/modules/installed.json   — per-module entries (keyed by moduleId)
 *   ~/.aihydro/courses/installed.json   — per-course entries (keyed by courseId)
 *
 * `version` + `sha256` are recorded at install time. The refresh RPCs compare
 * the stored version against the remote catalog version to compute
 * `updateAvailable`; the sha256 enables a future "content changed" check.
 */
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

export interface ModuleRegistryEntry {
	id: string
	title: string
	localPath: string
	installedAt: string
	/** Present only for modules installed as part of a course. */
	courseId?: string
	/** Catalog version recorded at install time (added in the update-awareness phase). */
	version?: string
	/** SHA-256 of the downloaded module.html at install time. */
	sha256?: string
}

export interface CourseRegistryEntry {
	courseId: string
	version: string
	installedAt: string
	/** moduleId → version recorded at install time. */
	moduleVersions: Record<string, string>
}

export const moduleRegistryPath = (): string => path.join(os.homedir(), ".aihydro", "modules", "installed.json")
export const courseRegistryPath = (): string => path.join(os.homedir(), ".aihydro", "courses", "installed.json")

async function readJson<T>(file: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await fs.readFile(file, "utf-8")) as T
	} catch {
		return fallback
	}
}

export async function readModuleRegistry(): Promise<Record<string, ModuleRegistryEntry>> {
	return readJson<Record<string, ModuleRegistryEntry>>(moduleRegistryPath(), {})
}

export async function writeModuleRegistry(registry: Record<string, ModuleRegistryEntry>): Promise<void> {
	const file = moduleRegistryPath()
	await fs.mkdir(path.dirname(file), { recursive: true })
	await fs.writeFile(file, JSON.stringify(registry, null, 2))
}

export async function readCourseRegistry(): Promise<Record<string, CourseRegistryEntry>> {
	return readJson<Record<string, CourseRegistryEntry>>(courseRegistryPath(), {})
}

export async function writeCourseRegistry(registry: Record<string, CourseRegistryEntry>): Promise<void> {
	const file = courseRegistryPath()
	await fs.mkdir(path.dirname(file), { recursive: true })
	await fs.writeFile(file, JSON.stringify(registry, null, 2))
}
