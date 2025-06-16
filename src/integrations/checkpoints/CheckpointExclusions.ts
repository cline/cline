import fs from "fs/promises"
import { join } from "path"
import { fileExistsAtPath } from "@utils/fs"
import { GIT_DISABLED_SUFFIX } from "./CheckpointGitOperations"

/**
 * CheckpointExclusions Module
 *
 * A specialized module within Cline's Checkpoints system that manages file exclusion rules
 * for the checkpoint tracking process. It provides:
 *
 * File Filtering:
 * - File types (build artifacts, media, cache files, etc.)
 * - Git LFS patterns from workspace
 * - Environment and configuration files
 * - Temporary and cache files
 *
 * Pattern Management:
 * - Extensible category-based pattern system
 * - Comprehensive file type coverage
 * - Easy pattern updates and maintenance
 *
 * Git Integration:
 * - Seamless integration with Git's exclude mechanism
 * - Support for workspace-specific LFS patterns
 * - Automatic pattern updates during checkpoints
 *
 * The module ensures efficient checkpoint creation by preventing unnecessary tracking
 * of large files, binary files, and temporary artifacts while maintaining a clean
 * and organized checkpoint history.
 */

/**
 * Returns the default list of file and directory patterns to exclude from checkpoints.
 * Combines built-in patterns with workspace-specific LFS patterns.
 *
 * @param lfsPatterns - Optional array of Git LFS patterns from workspace
 * @returns Array of glob patterns to exclude
 * @todo Make this configurable by the user
 */
export const getDefaultExclusions = (lfsPatterns: string[] = []): string[] => [
	// Build and Development Artifacts
	".git/",
	`.git${GIT_DISABLED_SUFFIX}/`,
	...getBuildArtifactPatterns(),

	// Media Files
	...getMediaFilePatterns(),

	// Cache and Temporary Files
	...getCacheFilePatterns(),

	// Environment and Config Files
	...getConfigFilePatterns(),

	// Large Data Files
	...getLargeDataFilePatterns(),

	// Database Files
	...getDatabaseFilePatterns(),

	// Geospatial Datasets
	...getGeospatialPatterns(),

	// Log Files
	...getLogFilePatterns(),

	...lfsPatterns,
]

/**
 * Returns patterns for common build and development artifact directories
 * @returns Array of glob patterns for build artifacts
 */
function getBuildArtifactPatterns(): string[] {
	return [
		".gradle/",
		".idea/",
		".parcel-cache/",
		".pytest_cache/",
		".next/",
		".nuxt/",
		".sass-cache/",
		".vs/",
		".vscode/",
		".clinerules/",
		"Pods/",
		"__pycache__/",
		"bin/",
		"build/",
		"bundle/",
		"coverage/",
		"deps/",
		"dist/",
		"env/",
		"node_modules/",
		"obj/",
		"out/",
		"pkg/",
		"pycache/",
		"target/dependency/",
		"temp/",
		"vendor/",
		"venv/",
	]
}

/**
 * Returns patterns for common media and image file types
 * @returns Array of glob patterns for media files
 */
function getMediaFilePatterns(): string[] {
	return [
		"*.jpg",
		"*.jpeg",
		"*.png",
		"*.gif",
		"*.bmp",
		"*.ico",
		"*.webp",
		"*.tiff",
		"*.tif",
		// "*.svg",
		"*.raw",
		"*.heic",
		"*.avif",
		"*.eps",
		"*.psd",
		"*.3gp",
		"*.aac",
		"*.aiff",
		"*.asf",
		"*.avi",
		"*.divx",
		"*.flac",
		"*.m4a",
		"*.m4v",
		"*.mkv",
		"*.mov",
		"*.mp3",
		"*.mp4",
		"*.mpeg",
		"*.mpg",
		"*.ogg",
		"*.opus",
		"*.rm",
		"*.rmvb",
		"*.vob",
		"*.wav",
		"*.webm",
		"*.wma",
		"*.wmv",
	]
}

/**
 * Returns patterns for cache, temporary, and system files
 * @returns Array of glob patterns for cache files
 */
function getCacheFilePatterns(): string[] {
	return [
		"*.DS_Store",
		"*.bak",
		"*.cache",
		"*.crdownload",
		"*.dmp",
		"*.dump",
		"*.eslintcache",
		"*.lock",
		"*.log",
		"*.old",
		"*.part",
		"*.partial",
		"*.pyc",
		"*.pyo",
		"*.stackdump",
		"*.swo",
		"*.swp",
		"*.temp",
		"*.tmp",
		"*.Thumbs.db",
	]
}

/**
 * Returns patterns for environment and configuration files
 * @returns Array of glob patterns for config files
 */
function getConfigFilePatterns(): string[] {
	return ["*.env*", "*.local", "*.development", "*.production"]
}

/**
 * Returns patterns for common large binary and archive files
 * @returns Array of glob patterns for large data files
 */
function getLargeDataFilePatterns(): string[] {
	return [
		"*.zip",
		"*.tar",
		"*.gz",
		"*.rar",
		"*.7z",
		"*.iso",
		"*.bin",
		"*.exe",
		"*.dll",
		"*.so",
		"*.dylib",
		"*.dat",
		"*.dmg",
		"*.msi",
	]
}

/**
 * Returns patterns for database and data storage files
 * @returns Array of glob patterns for database files
 */
function getDatabaseFilePatterns(): string[] {
	return [
		"*.arrow",
		"*.accdb",
		"*.aof",
		"*.avro",
		"*.bak",
		"*.bson",
		"*.csv",
		"*.db",
		"*.dbf",
		"*.dmp",
		"*.frm",
		"*.ibd",
		"*.mdb",
		"*.myd",
		"*.myi",
		"*.orc",
		"*.parquet",
		"*.pdb",
		"*.rdb",
		"*.sql",
		"*.sqlite",
	]
}

/**
 * Returns patterns for geospatial and mapping data files
 * @returns Array of glob patterns for geospatial files
 */
function getGeospatialPatterns(): string[] {
	return [
		"*.shp",
		"*.shx",
		"*.dbf",
		"*.prj",
		"*.sbn",
		"*.sbx",
		"*.shp.xml",
		"*.cpg",
		"*.gdb",
		"*.mdb",
		"*.gpkg",
		"*.kml",
		"*.kmz",
		"*.gml",
		"*.geojson",
		"*.dem",
		"*.asc",
		"*.img",
		"*.ecw",
		"*.las",
		"*.laz",
		"*.mxd",
		"*.qgs",
		"*.grd",
		"*.csv",
		"*.dwg",
		"*.dxf",
	]
}

/**
 * Returns patterns for log and debug output files
 * @returns Array of glob patterns for log files
 */
function getLogFilePatterns(): string[] {
	return ["*.error", "*.log", "*.logs", "*.npm-debug.log*", "*.out", "*.stdout", "yarn-debug.log*", "yarn-error.log*"]
}

/**
 * Writes the combined exclusion patterns to Git's exclude file.
 * Creates the info directory if it doesn't exist.
 *
 * @param gitPath - Path to the .git directory
 * @param lfsPatterns - Optional array of Git LFS patterns to include
 */
export const writeExcludesFile = async (gitPath: string, lfsPatterns: string[] = []): Promise<void> => {
	const excludesPath = join(gitPath, "info", "exclude")
	await fs.mkdir(join(gitPath, "info"), { recursive: true })

	const patterns = getDefaultExclusions(lfsPatterns)
	await fs.writeFile(excludesPath, patterns.join("\n"))
}

/**
 * Retrieves Git LFS patterns from the workspace's .gitattributes file.
 * Returns an empty array if no patterns found or file doesn't exist.
 *
 * @param workspacePath - Path to the workspace root
 * @returns Array of Git LFS patterns found in .gitattributes
 */
export const getLfsPatterns = async (workspacePath: string): Promise<string[]> => {
	try {
		const attributesPath = join(workspacePath, ".gitattributes")
		if (await fileExistsAtPath(attributesPath)) {
			const attributesContent = await fs.readFile(attributesPath, "utf8")
			return attributesContent
				.split("\n")
				.filter((line) => line.includes("filter=lfs"))
				.map((line) => line.split(" ")[0].trim())
		}
	} catch (error) {
		console.warn("Failed to read .gitattributes:", error)
	}
	return []
}
