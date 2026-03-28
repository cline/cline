import path from "node:path"
import { runKiroCliAcceptance } from "./acceptance-harness"

const getArgValue = (name: string) => {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

const main = async () => {
	const sessionId = getArgValue("--session-id") ?? "acceptance-session"
	const cwd = getArgValue("--cwd") ?? process.cwd()
	const runtimePath = getArgValue("--path")
	const outputFilePath = getArgValue("--output") ?? path.join(cwd, ".kiro-acceptance-output.txt")
	const timeoutMs = Number(getArgValue("--timeout-ms") ?? "60000")

	const result = await runKiroCliAcceptance({
		sessionId,
		path: runtimePath,
		cwd,
		timeoutMs,
		outputFilePath,
		env: {
			...process.env,
			CLINE_RUNTIME_SESSION_ID: sessionId,
		},
	})

	console.log(JSON.stringify(result, null, 2))
	process.exit(result.status === "passed" ? 0 : 1)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
