import { runLinuxAarch64KiroCliIsolationSmoke } from "./session-isolation-smoke"

const getArgValue = (name: string) => {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

const main = async () => {
	const runtimePath = getArgValue("--path")
	const timeoutMs = Number(getArgValue("--timeout-ms") ?? "60000")
	const result = await runLinuxAarch64KiroCliIsolationSmoke({
		path: runtimePath,
		timeoutMs,
	})

	console.log(JSON.stringify(result, null, 2))
	process.exit(result.passed ? 0 : 1)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
