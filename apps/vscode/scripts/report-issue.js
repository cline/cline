const { execSync } = require("child_process")
const readline = require("readline")
const os = require("os")

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})

const ask = (question) => new Promise((resolve) => rl.question(`\n${question}`, resolve))

const getBedrockCoderVersion = () => {
	try {
		const extensions = execSync("code --list-extensions --show-versions").toString()
		const bedrockCoderMatch = extensions.match(/fffalexgo\.bedrock-coder@(\d+\.\d+\.\d+)/)
		return bedrockCoderMatch ? bedrockCoderMatch[1] : "Not installed"
	} catch (_err) {
		return "Error getting version"
	}
}

const collectSystemInfo = () => {
	let cpuInfo = "N/A"
	let memoryInfo = "N/A"
	try {
		if (process.platform === "darwin") {
			cpuInfo = execSync("sysctl -n machdep.cpu.brand_string").toString().trim()
			memoryInfo = execSync("sysctl -n hw.memsize").toString().trim()
			memoryInfo = `${Math.round(parseInt(memoryInfo) / 1e9)} GB RAM`
		} else {
			// Linux specific commands
			cpuInfo = execSync("lscpu").toString().split("\n").slice(0, 5).join("\n")
			memoryInfo = execSync("free -h").toString()
		}
	} catch (_err) {
		// Fallback for unsupported systems
		cpuInfo = Array.from(new Set(os.cpus().map((c) => c.model))).join("\n")
		memoryInfo = `${Math.round(os.totalmem() / 1e9)} GB RAM`
	}

	return {
		cpuInfo,
		memoryInfo,
		os: `${os.arch()}; ${os.version()}`,
		nodeVersion: execSync("node -v").toString().trim(),
		bunVersion: execSync("bun --version").toString().trim(),
		bedrockCoderVersion: getBedrockCoderVersion(),
	}
}

const checkGitHubAuth = async () => {
	try {
		execSync("gh auth status", { stdio: "ignore" })
		return true
	} catch (_err) {
		console.log("\nGitHub authentication required.")
		console.log("\nPlease run the following command in your terminal to authenticate:")
		console.log("\n  gh auth login\n")
		console.log("After authenticating, run this script again.")
		return false
	}
}

const createIssueUrl = (systemInfo, issueTitle) => {
	return (
		`https://github.com/FFFalexgo/AWS_Bedrock_Coder/issues/new?template=bug_report.yml` +
		`&title=${issueTitle}` +
		`&operating-system=${systemInfo.os}` +
		`&bedrock-coder-version=${systemInfo.bedrockCoderVersion}` +
		`&system-info=${
			`Node: ${systemInfo.nodeVersion}\n` +
			`Bun: ${systemInfo.bunVersion}\n` +
			`CPU Info: ${systemInfo.cpuInfo}\n` +
			`Free RAM: ${systemInfo.memoryInfo}`
		}`
	)
}

const openUrl = (url) => {
	try {
		switch (process.platform) {
			case "darwin":
				execSync(`open "${url}"`)
				break
			case "win32":
				execSync(`start "" "${url}"`)
				break
			case "linux":
				execSync(`xdg-open "${url}"`)
				break
			default:
				console.log("\nPlease open this URL in your browser:")
				console.log(url)
		}
	} catch (_err) {
		console.log("\nFailed to open URL automatically. Please open this URL in your browser:")
		console.log(url)
	}
}

const submitIssue = async (issueTitle, systemInfo) => {
	try {
		const issueUrl = createIssueUrl(systemInfo, issueTitle)
		console.log("\nOpening GitHub issue creation page in your browser...")
		openUrl(issueUrl)
	} catch (err) {
		console.error("\nFailed to create issue URL:", err.message)
	}
}

async function main() {
	const consent = await ask("Do you consent to collect system data and submit a GitHub issue? (y/n): ")
	if (consent.trim().toLowerCase() !== "y") {
		console.log("\nAborted.")
		rl.close()
		return
	}

	console.log("Collecting system data...")
	const systemInfo = collectSystemInfo()

	const isAuthenticated = await checkGitHubAuth()
	if (!isAuthenticated) {
		rl.close()
		return
	}

	const issueTitle = await ask("Enter the title for your issue: ")

	await submitIssue(issueTitle, systemInfo)
	rl.close()
}

main().catch((err) => {
	console.error("\nAn error occurred:", err)
	rl.close()
})
