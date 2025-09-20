import { EmptyRequest } from "@shared/proto/cline/common"
import { SystemInfo } from "@shared/proto/cline/models"
import * as os from "os"
import { Controller } from "@/core/controller"

/**
 * Get system information
 * @param controller The controller instance
 * @param request Empty request
 * @returns System information
 */
export async function getSystemInfo(_controller: Controller, _request: EmptyRequest): Promise<SystemInfo> {
	return SystemInfo.create({
		platform: process.platform,
		arch: process.arch,
		totalMemory: os.totalmem(),
		freeMemory: os.freemem(),
		cpuCount: os.cpus().length,
		hostname: os.hostname(),
		uptime: os.uptime(),
	})
}
