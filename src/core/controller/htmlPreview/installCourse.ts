import type { InstallCourseRequest, InstallCourseResponse } from "@shared/proto/cline/html_preview"
import { InstallCourseResponse as InstallCourseResponseProto } from "@shared/proto/cline/html_preview"
import axios from "axios"
import { createHash } from "crypto"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
	type CourseRegistryEntry,
	type ModuleRegistryEntry,
	readCourseRegistry,
	writeCourseRegistry,
} from "@/services/htmlPreview/moduleRegistry"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"
import type { Controller } from "../index"

/**
 * Install a whole course: fetch the course.json manifest, download every member
 * module to a self-contained course directory under ~/.aihydro/courses/<courseId>,
 * register each module in installed.json (tagged with courseId), then open the
 * entry module so the course runtime (useCourse) walks up to course.json and
 * renders the navigator + progress.
 */
export async function installCourse(controller: Controller, request: InstallCourseRequest): Promise<InstallCourseResponse> {
	const { courseId, manifestUrl } = request
	try {
		if (!manifestUrl) throw new Error("Missing course manifest URL")

		// 1. Fetch the course manifest.
		const manifestResp = await axios.get(manifestUrl, { responseType: "json", timeout: 30000 })
		const manifest = manifestResp.data
		const resolvedCourseId = String(manifest.courseId || manifest.course_id || courseId || "")
		if (!resolvedCourseId) throw new Error("Course manifest has no courseId")

		const courseDir = path.join(os.homedir(), ".aihydro", "courses", resolvedCourseId)
		await fs.mkdir(courseDir, { recursive: true })

		const modules: any[] = Array.isArray(manifest.modules) ? manifest.modules : []
		if (modules.length === 0) throw new Error("Course manifest has no modules")

		// 2. Load the module registry once.
		const registryPath = path.join(os.homedir(), ".aihydro", "modules", "installed.json")
		let registry: Record<string, ModuleRegistryEntry> = {}
		try {
			registry = JSON.parse(await fs.readFile(registryPath, "utf-8"))
		} catch {
			// fresh registry
		}
		const courseVersion = String(manifest.version || "0.1.0")
		const moduleVersions: Record<string, string> = {}

		// 3. Download each module into the course directory. We NORMALIZE the
		// on-disk layout to "<moduleId>/module.html" (ignoring any "../" in the
		// manifest path) so the install is self-contained and can't escape the
		// course directory, then rewrite the manifest paths to match so the
		// runtime resolves modules correctly from courseRoot.
		let installed = 0
		const manifestBase = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1)
		for (const m of modules) {
			const moduleId = String(m.id || m.moduleId || m.module_id || "")
			const manifestPath = String(m.path || `${moduleId}/module.html`)
			const downloadUrl = String(m.downloadUrl || m.download_url || manifestBase + manifestPath)
			if (!moduleId || !downloadUrl) continue
			const relPath = `${moduleId}/module.html`
			try {
				const html = await axios.get(downloadUrl, { responseType: "text", timeout: 30000 })
				const htmlText = String(html.data)
				const dest = path.join(courseDir, relPath)
				await fs.mkdir(path.dirname(dest), { recursive: true })
				await fs.writeFile(dest, htmlText, "utf-8")
				// Rewrite the manifest entry to the normalized, contained path.
				m.path = relPath
				const moduleVersion = String(m.version || courseVersion)
				moduleVersions[moduleId] = moduleVersion
				registry[moduleId] = {
					id: moduleId,
					title: String(m.title || moduleId),
					localPath: dest,
					installedAt: new Date().toISOString(),
					courseId: resolvedCourseId,
					version: moduleVersion,
					sha256: createHash("sha256").update(htmlText).digest("hex"),
				}
				installed++
			} catch (err) {
				console.warn(`[installCourse] failed to download module ${moduleId}:`, err)
			}
		}

		if (installed === 0) throw new Error("No modules could be downloaded for this course")

		// 4. Persist the (path-normalized) course.json so the runtime resolves paths.
		await fs.writeFile(path.join(courseDir, "course.json"), JSON.stringify(manifest, null, 2), "utf-8")
		await fs.writeFile(registryPath, JSON.stringify(registry, null, 2))

		// Record the course-level install (version + per-module versions) so the
		// marketplace can detect when a newer course version ships.
		const courseRegistry = await readCourseRegistry()
		const courseEntry: CourseRegistryEntry = {
			courseId: resolvedCourseId,
			version: courseVersion,
			installedAt: new Date().toISOString(),
			moduleVersions,
		}
		courseRegistry[resolvedCourseId] = courseEntry
		await writeCourseRegistry(courseRegistry)

		// 5. Open the entry module — useCourse will discover course.json from here.
		const entry = modules[0]
		const entryModuleId = String(entry.id || entry.moduleId || entry.module_id || "")
		const entryPath = path.join(courseDir, String(entry.path || `${entryModuleId}/module.html`))
		const { PreviewHtmlRequest } = await import("@shared/proto/cline/html_preview")
		const { previewHtml } = await import("@core/controller/htmlPreview/previewHtml")
		await previewHtml(
			controller,
			PreviewHtmlRequest.create({ htmlContent: "", title: String(entry.title || entryModuleId), filePath: entryPath }),
		)

		void MarketplaceRecognitionService.recordEvent({
			marketplace: "courses",
			itemId: resolvedCourseId,
			eventType: "install",
			source: "ui",
		})

		return InstallCourseResponseProto.create({
			courseId: resolvedCourseId,
			success: true,
			modulesInstalled: installed,
			entryModuleId,
		})
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Course install failed"
		return InstallCourseResponseProto.create({ courseId, success: false, modulesInstalled: 0, entryModuleId: "", error: msg })
	}
}
