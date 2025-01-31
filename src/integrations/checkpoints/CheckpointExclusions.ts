import fs from "fs/promises"
import * as path from "path"
import { fileExistsAtPath } from "../../utils/fs"
import { GIT_DISABLED_SUFFIX } from "./CheckpointTracker"

// Types and Interfaces
// ===================

interface FileFilterCache {
    directoryPatterns: Set<string>
    extensionPatterns: Set<string>
}

interface ExclusionResult {
    excluded: boolean
    reason?: string
}

// Constants
// =========

const SIZE_LIMIT = 5 // 5 MB

// File Filter Cache
// ================

/**
 * Singleton cache instance for application-wide file filtering.
 * Used to avoid redundant pattern matching.
 */
const filterCache: FileFilterCache = {
    directoryPatterns: new Set(),
    extensionPatterns: new Set()
}

// Pattern Management
// =================

/**
 * Updates cache with new pattern sets and clears stale entries.
 * Processes directory patterns (ending with '/') and extension patterns (starting with '*.')
 */
export function initializeCache(patterns: string[]): void {
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

// Exclusion Checks
// ===============

/**
 * Helper function to check if path matches directory exclusions
 */
function isExcludedDirectory(filePath: string): ExclusionResult {
    const normalizedPath = filePath.replace(/\\/g, "/")
    const parts = normalizedPath.split("/").filter(Boolean)

    for (const dir of filterCache.directoryPatterns) {
        const matchResult = checkDirectoryMatch(parts, dir)
        if (matchResult.excluded) {
            return matchResult
        }
    }

    return { excluded: false }
}

/**
 * Helper function to check directory pattern matches
 */
function checkDirectoryMatch(pathParts: string[], pattern: string): ExclusionResult {
    for (const part of pathParts) {
        // Exact match or .git special case
        if (part === pattern || (pattern === ".git" && part === `.git${GIT_DISABLED_SUFFIX}`)) {
            return {
                excluded: true,
                reason: `Directory matches excluded pattern: ${part}`
            }
        }

        // Check if the part starts with the pattern and is followed by a space or special character
        const patternRegex = new RegExp(`^${pattern}(?:\\s|$)`)
        if (patternRegex.test(part)) {
            return {
                excluded: true,
                reason: `Directory matches excluded pattern: ${pattern}`
            }
        }
    }

    return { excluded: false }
}

/**
 * Helper function to check if path matches extension exclusions
 */
function isExcludedExtension(filePath: string): ExclusionResult {
    const ext = path.extname(filePath)
    return {
        excluded: filterCache.extensionPatterns.has(ext),
        reason: filterCache.extensionPatterns.has(ext) ? `File extension ${ext} is excluded` : undefined
    }
}

/**
 * Helper function to check if file exceeds size limit
 */
async function isOverSizeLimit(filePath: string): Promise<ExclusionResult> {
    try {
        const stats = await fs.stat(filePath)
        const sizeInMB = stats.size / (1024 * 1024)

        return {
            excluded: sizeInMB > SIZE_LIMIT,
            reason: sizeInMB > SIZE_LIMIT
                ? `File size ${sizeInMB.toFixed(2)}MB exceeds ${SIZE_LIMIT}MB limit`
                : undefined
        }
    } catch {
        return { excluded: false }
    }
}

// Default Exclusions
// =================

/**
 * Returns the default list of file and directory patterns to exclude
 * TODO: Make this configurable by the user
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

// Pattern Category Helpers
// =======================

function getBuildArtifactPatterns(): string[] {
    return [
        ".gradle/", ".idea/", ".parcel-cache/", ".pytest_cache/",
        ".next/", ".nuxt/", ".sass-cache/", ".vs/", ".vscode/",
        "Pods/", "__pycache__/", "bin/", "build/", "bundle/",
        "coverage/", "deps/", "dist/", "env/", "node_modules/",
        "obj/", "out/", "pkg/", "pycache/", "target/dependency/",
        "temp/", "vendor/", "venv/"
    ];
}

function getMediaFilePatterns(): string[] {
    return [
        "*.jpg", "*.jpeg", "*.png", "*.gif", "*.bmp", "*.ico",
        "*.webp", "*.tiff", "*.tif", "*.svg", "*.raw", "*.heic",
        "*.avif", "*.eps", "*.psd", ".3gp", ".aac", ".aiff",
        ".asf", ".avi", ".divx", ".flac", ".m4a", ".m4v",
        ".mkv", ".mov", ".mp3", ".mp4", ".mpeg", ".mpg",
        ".ogg", ".opus", ".rm", ".rmvb", ".vob", ".wav",
        ".webm", ".wma", ".wmv"
    ];
}

function getCacheFilePatterns(): string[] {
    return [
        ".DS_Store", ".bak", ".cache", ".crdownload", ".dmp",
        ".dump", ".eslintcache", ".lock", ".log", ".old",
        ".part", ".partial", ".pyc", ".pyo", ".stackdump",
        ".swo", ".swp", ".temp", ".tmp", "Thumbs.db"
    ];
}

function getConfigFilePatterns(): string[] {
    return [
        ".env*", "*.local", "*.development", "*.production"
    ];
}

function getLargeDataFilePatterns(): string[] {
    return [
        "*.zip", "*.tar", "*.gz", "*.rar", "*.7z", "*.iso",
        "*.bin", "*.exe", "*.dll", "*.so", "*.dylib", "*.dat",
        "*.dmg", "*.msi"
    ];
}

function getDatabaseFilePatterns(): string[] {
    return [
        "*.arrow", "*.accdb", ".aof", "*.avro", ".bak", "*.bson",
        ".csv", ".db", ".dbf", ".dmp", "*.frm", "*.ibd", ".mdb",
        "*.myd", "*.myi", ".orc", ".parquet", ".pdb", ".rdb",
        ".sql", ".sqlite"
    ];
}

function getGeospatialPatterns(): string[] {
    return [
        ".shp", ".shx", ".dbf", ".prj", ".sbn", ".sbx", ".shp.xml",
        ".cpg", ".gdb", ".mdb", ".gpkg", ".kml", ".kmz", ".gml",
        ".geojson", ".dem", ".asc", ".img", ".ecw", ".las", ".laz",
        ".mxd", ".qgs", ".grd", ".csv", ".dwg", ".dxf"
    ];
}

function getLogFilePatterns(): string[] {
    return [
        "*.error", "*.log", "*.logs", "npm-debug.log*", "*.out",
        "*.stdout", "yarn-debug.log*", "yarn-error.log*"
    ];
}

// ... Similar helper functions for other categories ...
// (Implementation of other pattern category helpers would go here)

// File Operations
// ==============

/**
 * Writes exclusion patterns to Git's exclude file
 */
export const writeExcludesFile = async (gitPath: string, lfsPatterns: string[] = []): Promise<void> => {
    const excludesPath = path.join(gitPath, "info", "exclude")
    await fs.mkdir(path.join(gitPath, "info"), { recursive: true })

    const patterns = getDefaultExclusions(lfsPatterns)
    await fs.writeFile(excludesPath, patterns.join("\n"))

    initializeCache(patterns)
}

/**
 * Retrieves LFS patterns from workspace if they exist
 */
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

/**
 * Main function to determine if a file should be excluded based on
 * multiple criteria, ordered from fastest to most expensive checks.
 */
export const shouldExcludeFile = async (filePath: string): Promise<ExclusionResult> => {
    try {
        // 1. Check directory exclusions (fastest)
        const dirResult = isExcludedDirectory(filePath)
        if (dirResult.excluded) {return dirResult}

        // 2. Check extension exclusions
        const extResult = isExcludedExtension(filePath)
        if (extResult.excluded) {return extResult}

        // 3. Check file size (most expensive)
        const sizeResult = await isOverSizeLimit(filePath)
        if (sizeResult.excluded) {return sizeResult}

        return { excluded: false }
    } catch (error) {
        console.log("Error in shouldExcludeFile:", error)
        return { excluded: false }
    }
}

// Initialize cache when module loads
initializeCache(getDefaultExclusions())
