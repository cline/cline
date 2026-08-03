// Windows Job Object support (V14 report §2.4 / P2 "Windows Job Object 进程组清理接入")
//
// Problem: on Windows, a hard-killed parent (extension host crash, OOM,
// `taskkill /F` on the host) leaves orphaned child/grandchild processes
// (MCP-spawned python/node, hook subprocesses, terminal shells) behind —
// `tree-kill`'s `taskkill /T /F` only runs while the parent is still alive.
//
// Solution (zero-dependency): Node.js 22+ supports the `windowsJob: true`
// spawn option. The child is placed in a Job Object configured with
// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; when the parent process exits, the OS
// terminates the ENTIRE job — including grandchildren. This module is the
// single place that decides whether that option is applied, so the capability
// check lives here rather than in callers.
//
// Runtime note: the extension host runs on the Node runtime shipped inside
// VS Code (Electron), which is >= 22 for current Cline builds; the check is
// still defensive so the bundle keeps working on older hosts.

import { type SpawnOptions, spawn } from "node:child_process"

/**
 * Node major version that introduced the `windowsJob` spawn option (v22.0.0).
 * Older Node versions silently ignore unknown spawn options; gating on the
 * version keeps the behavior explicit instead of relying on silent-ignore.
 */
export const WINDOWS_JOB_NODE_MAJOR = 22

/** Spawn options carrying the optional Windows Job flag (typed for older @types/node). */
export type WindowsJobSpawnOptions = SpawnOptions & { windowsJob?: boolean }

/**
 * True when the current process can use the `windowsJob` spawn option:
 * Windows platform + Node >= 22. POSIX never needs it (process groups are
 * handled by signals/tree-kill).
 */
export function isWindowsJobObjectSupported(): boolean {
	if (process.platform !== "win32") {
		return false
	}
	const major = Number(process.versions.node.split(".")[0])
	return Number.isFinite(major) && major >= WINDOWS_JOB_NODE_MAJOR
}

/**
 * Return a NEW options object with `windowsJob: true` applied when the
 * runtime supports it. The input object is never mutated.
 *
 * @param options spawn options to augment
 * @param force override the platform/version check (used by unit tests and by
 *   hosts that spawn under a different runtime than the extension host)
 */
export function withWindowsJob<T extends SpawnOptions>(options: T, force = false): WindowsJobSpawnOptions {
	if (!force && !isWindowsJobObjectSupported()) {
		return options
	}
	return { ...options, windowsJob: true }
}

/**
 * child_process.spawn() wrapper that always applies the Windows Job Object
 * option when the runtime supports it — drop-in replacement for `spawn`.
 */
export function spawnWithWindowsJob(
	command: string,
	args: readonly string[],
	options: SpawnOptions = {},
): ReturnType<typeof spawn> {
	return spawn(command, args as string[], withWindowsJob(options))
}
