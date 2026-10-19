import { execFile } from "child_process"
import os from "os"
import { promisify } from "util"
import { LocalGpuInfo, LocalHardwareInfo } from "@/shared/proto/cline/models"

const execFileAsync = promisify(execFile)
const BYTES_PER_GB = 1024 ** 3

let hardwarePromise: Promise<LocalHardwareInfo> | undefined

async function detectNvidiaGpus(): Promise<LocalGpuInfo[]> {
	try {
		const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], {
			timeout: 3000,
			windowsHide: true,
		})
		return stdout
			.split("\n")
			.map((line) => line.split(",").map((part) => part.trim()))
			.filter(([name, memoryMib]) => name && Number(memoryMib) > 0)
			.map(([name, memoryMib]) => LocalGpuInfo.create({ name, memoryGb: Number(memoryMib) / 1024 }))
	} catch {
		return []
	}
}

async function detectHardware(): Promise<LocalHardwareInfo> {
	const platform = os.platform()
	const arch = os.arch()
	const cpus = os.cpus()
	// Apple Silicon GPUs share system memory, so there is no separate VRAM to query.
	const unifiedMemory = platform === "darwin" && arch === "arm64"
	return LocalHardwareInfo.create({
		platform,
		arch,
		cpuModel: cpus[0]?.model.trim() ?? "",
		cpuCores: cpus.length,
		totalMemoryGb: os.totalmem() / BYTES_PER_GB,
		unifiedMemory,
		gpus: unifiedMemory ? [] : await detectNvidiaGpus(),
	})
}

/** Hardware doesn't change while the extension runs, so detection happens once. */
export function getLocalHardwareInfo(): Promise<LocalHardwareInfo> {
	hardwarePromise ??= detectHardware()
	return hardwarePromise
}
