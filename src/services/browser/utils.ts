import PCR from "puppeteer-chromium-resolver"
import { launch } from "puppeteer-core"
import { HostProvider } from "@/hosts/host-provider"

interface PCRStats {
	puppeteer: { launch: typeof launch }
	executablePath: string
}

export async function ensureChromiumExists(): Promise<PCRStats> {
	const puppeteerDir = HostProvider.ensureGlobalStorageDirExists("puppeteer")
	// if chromium doesn't exist, this will download it to path.join(puppeteerDir, ".chromium-browser-snapshots")
	// if it does exist it will return the path to existing chromium
	const stats: PCRStats = await PCR({
		downloadPath: puppeteerDir,
	})
	return stats
}
