import fs from "fs/promises"
import * as path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import { execa } from "execa"

const GIT_DISABLED_SUFFIX = "_disabled"

// Type definition for the file filtering cache system
// Tracks directory/extension patterns and binary file results for performance optimization
interface FileFilterCache {
	directoryPatterns: Set<string>
	extensionPatterns: Set<string>
	binaryResults: Map<string, boolean>
}

// Singleton cache instance for application-wide file filtering
// Used to avoid redundant pattern matching and binary checks
const filterCache: FileFilterCache = {
	directoryPatterns: new Set(),
	extensionPatterns: new Set(),
	binaryResults: new Map(),
}

// Updates cache with new pattern sets and clears stale entries
// Processes directory patterns (ending with '/') and extension patterns (starting with '*.')
function initializeCache(patterns: string[]): void {
	filterCache.directoryPatterns.clear()
	filterCache.extensionPatterns.clear()

	patterns.forEach((pattern) => {
		if (pattern.endsWith("/")) {
			filterCache.directoryPatterns.add(pattern.slice(0, -1))
		} else if (pattern.startsWith("*.")) {
			filterCache.extensionPatterns.add(pattern.slice(1))
		}
	})
}

// Helper function to check if path matches directory exclusions
function isExcludedDirectory(filePath: string): boolean {
	const normalizedPath = filePath.replace(/\\/g, "/")
	return Array.from(filterCache.directoryPatterns).some(
		(dir) => normalizedPath.includes(`/${dir}/`) || normalizedPath.endsWith(`/${dir}`),
	)
}

// Helper function to check if path matches extension exclusions
function isExcludedExtension(filePath: string): boolean {
	const ext = path.extname(filePath)
	return filterCache.extensionPatterns.has(ext)
}

// Helper function to check if file exceeds size limit (10MB)
async function isOverSizeLimit(filePath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(filePath)
		return stats.size > 10 * 1024 * 1024 // 10MB limit
	} catch {
		return false
	}
}

// TODO Make this configurable by the user
export const getDefaultExclusions = (lfsPatterns: string[] = []): string[] => [
	".git/", // ignore the user's .git
	`.git${GIT_DISABLED_SUFFIX}/`, // ignore the disabled nested git repos
	//Build and Development Artifacts
	"*.log",
	".DS_Store",
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
	"build/dependencies/",
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
	"tmp/",
	"vendor/",
	"venv/",

	// Image files
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
	// ".ai", // Adobe Illustrator, commented out as some users may use this extension in AI projects
	// "*.svg", // SVG files were commented out in the original exclusion implementation

	// Audio & Video files
	".3gp",
	".aac",
	".aiff",
	".asf",
	".avi",
	".divx",
	".flac",
	".m4a",
	".m4v",
	".mkv",
	".mov",
	".mp3",
	".mp4",
	".mpeg",
	".mpg",
	".ogg",
	".opus",
	".rm",
	".rmvb",
	".ts",
	".vob",
	".wav",
	".webm",
	".webp",
	".wma",
	".wmv",

	// Cache and temporary files
	".DS_Store",
	".bak",
	".cache",
	".crdownload",
	".dmp",
	".dump",
	".eslintcache",
	".lock",
	".log",
	".old",
	".part",
	".partial",
	".pyc",
	".pyo",
	".stackdump",
	".swo",
	".swp",
	".temp",
	".tmp",
	"Thumbs.db",

	// Environment and config files
	".env*",
	"*.local",
	"*.development",
	"*.production",

	// Large data files
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

	// Database files
	"*.arrow",
	"*.accdb",
	".aof",
	"*.avro",
	".bak",
	"*.bson",
	".csv",
	".db",
	".dbf",
	".dmp",
	"*.frm",
	"*.ibd",
	".mdb",
	"*.myd",
	"*.myi",
	".orc",
	".parquet",
	".pdb",
	".rdb",
	".sql",
	".sqlite",

	// Geospatial datasets
	".shp",
	".shx",
	".dbf",
	".prj",
	".sbn",
	".sbx",
	".shp.xml",
	".cpg",
	".gdb",
	".mdb",
	".gpkg",
	".kml",
	".kmz",
	".gml",
	".geojson",
	".dem",
	".asc",
	".img",
	".ecw",
	".las",
	".laz",
	".mxd",
	".qgs",
	".grd",
	".csv",
	".dwg",
	".dxf",

	// Log files
	"*.error",
	"*.log",
	"*.logs",
	"npm-debug.log*",
	"*.out",
	"*.stdout",
	"yarn-debug.log*",
	"yarn-error.log*",
	...lfsPatterns,
]

export const writeExcludesFile = async (gitPath: string, lfsPatterns: string[] = []): Promise<void> => {
	const excludesPath = path.join(gitPath, "info", "exclude")
	await fs.mkdir(path.join(gitPath, "info"), { recursive: true })
	const patterns = getDefaultExclusions(lfsPatterns)
	await fs.writeFile(excludesPath, patterns.join("\n"))

	// Reinitialize cache with new patterns
	initializeCache(patterns)
	// Clear binary results cache as patterns have changed
	filterCache.binaryResults.clear()
}
// Get LFS patterns from workspace if they exist
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
		console.warn("Failed to read .gitattributes:", error)
	}
	return []
}

/**
 * Checks if a file is binary based on the operating system.
 * Uses different approaches for Windows vs Unix-like systems.
 * Implements caching and optimized buffer reading.
 * @param filePath - Path to the file to check
 * @returns Promise<boolean> - True if the file is binary, false otherwise
 */
export const isBinaryFile = async (filePath: string): Promise<boolean> => {
	// Windows-specific implementation
	if (process.platform === "win32") {
		const cachedResult = filterCache.binaryResults.get(filePath)
		if (cachedResult !== undefined) {
			return cachedResult
		}

		let fileHandle: fs.FileHandle | null = null
		try {
			fileHandle = await fs.open(filePath, "r")
			const buffer = new Uint8Array(512) // May need to adjust buffer size if this is too slow
			const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0)

			// Using includes() is faster than some() for small arrays
			const isBinary = buffer.subarray(0, bytesRead).includes(0)
			filterCache.binaryResults.set(filePath, isBinary)
			return isBinary
		} catch (error) {
			console.warn("Failed to check if file is binary (win32):", error)
			return false
		} finally {
			if (fileHandle) {
				try {
					await fileHandle.close()
				} catch (err) {
					console.warn("Error closing file handle:", err)
				}
			}
		}
	} else {
		// Unix-like systems implementation using 'file' command
		try {
			const { stdout } = await execa(`file --mime-type "${filePath}"`)
			const isBinary = stdout.toLowerCase().includes("binary")
			filterCache.binaryResults.set(filePath, isBinary)
			return isBinary
		} catch (error) {
			console.warn("Failed to check if file is binary using 'file' command:", error)
			return false
		}
	}
}

/**
 * Main function to determine if a file should be excluded based on
 * multiple criteria, ordered from fastest to most expensive checks.
 * @param filePath - Path to the file to check
 * @returns Promise<boolean> - True if the file should be excluded
 */
export const shouldExcludeFile = async (filePath: string): Promise<boolean> => {
	try {
		// 1. Check directory exclusions (fastest)
		if (isExcludedDirectory(filePath)) {
			return true
		}

		// 2. Check extension exclusions
		if (isExcludedExtension(filePath)) {
			return true
		}

		// 3 & 4. Check size and binary in parallel (most expensive operations)
		const [sizeResult, binaryResult] = await Promise.all([isOverSizeLimit(filePath), isBinaryFile(filePath)])

		return sizeResult || binaryResult
	} catch (error) {
		console.warn("Error in shouldExcludeFile:", error)
		return false // Default to not excluding on error
	}
}

// Initialize cache when module loads
initializeCache(getDefaultExclusions())
