import { spawn } from "node:child_process"

const forwardedArgs = process.argv.slice(2)
const heapMb = process.env.CLINE_TEST_MAX_OLD_SPACE_SIZE_MB || "768"

if (forwardedArgs.length === 0) {
	console.error(
		"Usage: npm run test:unit:low-heap -- <test-file-or-glob> [additional mocha args...]\n" +
			"Example: npm run test:unit:low-heap -- src/test/stress-utils.test.ts\n" +
			"Override heap with CLINE_TEST_MAX_OLD_SPACE_SIZE_MB=<mb> if you want a more aggressive stress limit.",
	)
	process.exit(1)
}

const child = spawn(
	process.execPath,
	[
		`--max-old-space-size=${heapMb}`,
		"--require",
		"ts-node/register/transpile-only",
		"--require",
		"source-map-support/register",
		"--require",
		"tsconfig-paths/register",
		"--require",
		"./src/test/requires.ts",
		"./node_modules/mocha/bin/mocha",
		"--no-config",
		...forwardedArgs,
	],
	{
		stdio: "inherit",
		env: {
			...process.env,
			TS_NODE_PROJECT: process.env.TS_NODE_PROJECT || "./tsconfig.unit-test.json",
		},
	},
)

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal)
		return
	}
	process.exit(code ?? 1)
})
