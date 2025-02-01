import fs from "fs/promises"
import * as path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import { GIT_DISABLED_SUFFIX } from "./CheckpointTracker"

//*
// CheckpointExclusions
//
// A specialized module within Cline's Checkpoints system that manages file exclusion rules
// for the checkpoint tracking process. It provides:
//
// - File filtering based on multiple criteria:
//   - Size limits (default 5MB)
//   - File types (build artifacts, media, cache files, etc.)
//   - Git LFS patterns
//   - Environment and configuration files
//
// - Extensible pattern management
// - Integration with Git's exclude mechanism
// - Support for workspace-specific LFS pattern detection
//
// The module ensures efficient checkpoint creation by preventing unnecessary tracking
// of large files and temporary files while maintaining a clean and organized
// checkpoint history.

// Interfaces
// ===================

interface ExclusionResult {
	excluded: boolean
	reason?: string
}

// Constants
// =========

const SIZE_LIMIT = 5 // 5 MB

// Helper function to check if file exceeds size limit
// ===================================================
async function isOverSizeLimit(filePath: string): Promise<ExclusionResult> {
	try {
		const stats = await fs.stat(filePath)
		const sizeInMB = stats.size / (1024 * 1024)

		return {
			excluded: sizeInMB > SIZE_LIMIT,
			reason: sizeInMB > SIZE_LIMIT ? `File size ${sizeInMB.toFixed(2)}MB exceeds ${SIZE_LIMIT}MB limit` : undefined,
		}
	} catch {
		return { excluded: false }
	}
}

// Default Exclusions
// =================

// Returns the default list of file and directory patterns to exclude
// TODO: Make this configurable by the user
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

// Pattern Category Helpers
// =======================

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
		"*.svg",
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

function getConfigFilePatterns(): string[] {
	return ["*.env*", "*.local", "*.development", "*.production"]
}

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

function getLogFilePatterns(): string[] {
	return ["*.error", "*.log", "*.logs", "*.npm-debug.log*", "*.out", "*.stdout", "yarn-debug.log*", "yarn-error.log*"]
}

// File Operations
// ==============

// Writes exclusion patterns to Git's exclude file
export const writeExcludesFile = async (gitPath: string, lfsPatterns: string[] = []): Promise<void> => {
	const excludesPath = path.join(gitPath, "info", "exclude")
	await fs.mkdir(path.join(gitPath, "info"), { recursive: true })

	const patterns = getDefaultExclusions(lfsPatterns)
	await fs.writeFile(excludesPath, patterns.join("\n"))
}

// Retrieves LFS patterns from workspace if they exist
export const getLfsPatterns = async (workspacePath: string): Promise<string[]> => {
	try {
		const attributesPath = path.join(workspacePath, ".gitattributes")
		if (await fileExistsAtPath(attributesPath)) {
			const attributesContent = await fs.readFile(attributesPath, "utf8")
			return attributesContent
				.split("\n")
				.filter((line) => line.includes("filter=lfs"))
				.map((line) => line.split(" ")[0].trim())
		}
	} catch (error) {
		console.log("Failed to read .gitattributes:", error)
	}
	return []
}

// Main function to determine if a file should be excluded based on
// multiple criteria, ordered from fastest to most expensive checks.
export const shouldExcludeFile = async (filePath: string): Promise<ExclusionResult> => {
	try {
		const sizeResult = await isOverSizeLimit(filePath)
		if (sizeResult.excluded) {
			return sizeResult
		}
		return { excluded: false }
	} catch (error) {
		console.log("Error in shouldExcludeFile:", error)
		return { excluded: false }
	}
}
