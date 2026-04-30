import { exec } from "node:child_process"
import { realpath } from "node:fs/promises"
import { promisify } from "node:util"

const execAsync = promisify(exec)

/**
 * Coarse bucket for dashboards. The picker walks the whole tree on every
 * keystroke; "network" mounts have very different latency characteristics
 * from "local" ones and we want to filter slow events by this.
 */
export type FsClass = "local" | "network" | "unknown"

export interface FsInfo {
	fsClass: FsClass
	/** Lowercase, whitespace-stripped FS type as reported by the OS, or "unknown". */
	fsType: string
}

const UNKNOWN: FsInfo = { fsClass: "unknown", fsType: "unknown" }

// Best-effort classification. Anything we don't recognise lands in "unknown"
// rather than being misreported as "local".
//
// On macOS, SSHFS / FUSE-T / NTFS-3G / gocryptfs / rclone all surface as
// "macfuse" (or "fuse" on older macOS) in `mount` output — macFUSE doesn't
// expose the underlying driver. We bucket all of them as "network" since
// they share the not-actually-local performance profile that motivated this
// work.
const NETWORK_FS_TYPES = new Set([
	"nfs",
	"nfs3",
	"nfs4",
	"cifs",
	"smb",
	"smbfs",
	"smb2",
	"afpfs",
	"webdav",
	"davfs",
	"sshfs",
	"9p",
	"9p2000",
	"fuse",
	"fuseblk",
	"macfuse",
])

const LOCAL_FS_TYPES = new Set([
	"apfs",
	"hfs",
	"hfsplus",
	"ext2",
	"ext3",
	"ext4",
	"ext2/ext3",
	"btrfs",
	"xfs",
	"f2fs",
	"zfs",
	"reiserfs",
	"jfs",
	"ntfs",
	"ntfs3",
	"vfat",
	"fat",
	"fat32",
	"exfat",
	"msdos",
	"tmpfs",
	"ramfs",
	"overlay",
	"overlayfs",
	"iso9660",
	"udf",
])

const cache = new Map<string, FsInfo>()

/**
 * Returns coarse + specific filesystem info for `path`, cached per path for
 * the lifetime of the process. FS doesn't change at runtime so a cache hit
 * is cheap and correct; a cache miss runs `stat -f` once (~ms).
 *
 * Falls back to {@link UNKNOWN} on any error or unsupported platform — the
 * caller never has to handle exceptions.
 */
export async function getFsInfo(path: string | undefined | null): Promise<FsInfo> {
	if (!path) {
		return UNKNOWN
	}
	const cached = cache.get(path)
	if (cached) {
		return cached
	}
	const info = await detect(path)
	cache.set(path, info)
	return info
}

async function detect(path: string): Promise<FsInfo> {
	try {
		// Resolve symlinks so we match mountpoints correctly. On macOS `/tmp`
		// is a symlink to `/private/tmp`, and /tmp itself isn't a mount point.
		let resolved = path
		try {
			resolved = await realpath(path)
		} catch {
			// Path may not exist; fall back to the original string.
		}
		if (process.platform === "darwin") {
			return await detectMacOS(resolved)
		}
		if (process.platform === "linux") {
			// GNU stat: `-f` selects filesystem mode, `-c %T` prints the FS type
			// as a string ("ext2/ext3", "btrfs", "nfs", "fuseblk", ...).
			const { stdout } = await execAsync(`stat -f -c %T -- ${shellEscape(resolved)}`, {
				timeout: 2000,
			})
			return classify(stdout)
		}
		// Windows detection is more involved (GetVolumeInformationW + GetDriveType
		// or WMI) and we don't have a confirmed slow-FS report there yet. Land
		// macOS/Linux first; revisit if signal warrants.
		return UNKNOWN
	} catch {
		return UNKNOWN
	}
}

/**
 * macOS detection by parsing `mount(8)` output and picking the longest
 * matching mount point. BSD `stat` has no portable filesystem-type flag —
 * `stat -f` is a format-string mode where `%T` means "file type"
 * (regular/directory/etc.), not "filesystem type". Parsing `mount` is the
 * pragmatic alternative.
 *
 * Lines look like:
 *   /dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
 *   user@host:/repo on /Volumes/repo (macfuse, nodev, nosuid, ...)
 */
async function detectMacOS(resolvedPath: string): Promise<FsInfo> {
	const { stdout } = await execAsync("mount", { timeout: 2000 })
	let bestMountpoint = ""
	let bestFsType = ""
	for (const line of stdout.split("\n")) {
		const m = line.match(/^\S+\s+on\s+(.+?)\s+\(([^,)]+)/)
		if (!m) {
			continue
		}
		const [, mountpoint, fsType] = m
		const prefix = mountpoint.endsWith("/") ? mountpoint : mountpoint + "/"
		if (resolvedPath === mountpoint || resolvedPath.startsWith(prefix)) {
			if (mountpoint.length > bestMountpoint.length) {
				bestMountpoint = mountpoint
				bestFsType = fsType
			}
		}
	}
	return bestFsType ? classify(bestFsType) : UNKNOWN
}

function classify(rawFsType: string): FsInfo {
	const normalized = normalize(rawFsType)
	if (!normalized) {
		return UNKNOWN
	}
	if (NETWORK_FS_TYPES.has(normalized)) {
		return { fsClass: "network", fsType: normalized }
	}
	if (LOCAL_FS_TYPES.has(normalized)) {
		return { fsClass: "local", fsType: normalized }
	}
	return { fsClass: "unknown", fsType: normalized }
}

function normalize(raw: string): string {
	return raw.trim().replace(/\s+/g, "").toLowerCase()
}

function shellEscape(p: string): string {
	// POSIX single-quote escape: 'foo'\''bar' for a path containing a quote.
	return `'${p.replace(/'/g, "'\\''")}'`
}

/** Test-only. Resets the per-process cache. */
export function _resetFsInfoCacheForTests(): void {
	cache.clear()
}
