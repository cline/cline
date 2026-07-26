import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const runBuf = (args) =>
	spawnSync(process.platform === "win32" ? join(process.cwd(), "node_modules", ".bin", "buf.exe") : "buf", args, {
		env: { ...process.env, BUF_CACHE_DIR: join(process.cwd(), "node_modules", ".cache", "buf") },
		stdio: "inherit",
	})

const lintResult = runBuf(["lint"])
if (lintResult.status !== 0) {
	process.exit(lintResult.status ?? 1)
}

const formatResult = runBuf(["format", "-w", "--exit-code"])
if (formatResult.status !== 0) {
	console.log("Proto files were formatted")
}

const protoFiles = []
const collectProtoFiles = (directory) => {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name)
		if (entry.isDirectory()) {
			collectProtoFiles(entryPath)
		} else if (entry.isFile() && entry.name.endsWith(".proto")) {
			protoFiles.push(entryPath)
		}
	}
}

collectProtoFiles("proto")
const repeatedCapitals = /rpc .*[A-Z][A-Z].*\(/
const violations = []
for (const file of protoFiles) {
	for (const [index, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
		if (repeatedCapitals.test(line)) {
			violations.push(`${file}:${index + 1}:${line}`)
		}
	}
}

if (violations.length > 0) {
	console.error(violations.join("\n"))
	console.error("Error: Proto RPC names cannot contain repeated capital letters")
	process.exit(1)
}
