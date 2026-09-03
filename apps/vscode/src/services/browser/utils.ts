import { fileExistsAtPath } from "@utils/fs"
import * as fs from "fs/promises"
import * as path from "path"
// @ts-expect-error
import PCR from "puppeteer-chromium-resolver"
import { launch } from "puppeteer-core"
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
