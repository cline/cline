import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileExistsAtPath } from "@utils/fs"
// @ts-ignore
import PCR from "puppeteer-chromium-resolver"
import type { launch } from "puppeteer-core"
import { HostProvider } from "@/hosts/host-provider"

interface PCRStats {
	puppeteer: { launch: typeof launch }
	executablePath: string
}

export async function ensureChromiumExists(): Promise<PCRStats> {
	const puppeteerDir = path.join(HostProvider.get().globalStorageFsPath, "puppeteer")
	const dirExists = await fileExistsAtPath(puppeteerDir)
	if (!dirExists) {
		await fs.mkdir(puppeteerDir, { recursive: true })
	}
	// if chromium doesn't exist, this will download it to path.join(puppeteerDir, ".chromium-browser-snapshots")
	// if it does exist it will return the path to existing chromium
	const stats: PCRStats = await PCR({
		downloadPath: puppeteerDir,
	})
	return stats
}
