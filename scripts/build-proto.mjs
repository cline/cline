#!/usr/bin/env node

import chalk from "chalk"
import { execSync } from "child_process"
import * as fs from "fs/promises"
import { globby } from "globby"
import { createRequire } from "module"
import os from "os"
import * as path from "path"
import { rmrf } from "./file-utils.mjs"
import { main as generateHostBridgeClient } from "./generate-host-bridge-client.mjs"
import { main as generateProtoBusSetup } from "./generate-protobus-setup.mjs"

const require = createRequire(import.meta.url)
const PROTOC = path.join(require.resolve("grpc-tools"), "../bin/protoc")

const PROTO_DIR = path.resolve("proto")
const TS_OUT_DIR = path.resolve("src/shared/proto")
const GRPC_JS_OUT_DIR = path.resolve("src/generated/grpc-js")
const NICE_JS_OUT_DIR = path.resolve("src/generated/nice-grpc")
const DESCRIPTOR_OUT_DIR = path.resolve("dist-standalone/proto")

const isWindows = process.platform === "win32"
const TS_PROTO_PLUGIN = isWindows
	? path.resolve("node_modules/.bin/protoc-gen-ts_proto.cmd") // Use the .bin directory path for Windows
	: require.resolve("ts-proto/protoc-gen-ts_proto")

const TS_PROTO_OPTIONS = [
	"env=node",
	"esModuleInterop=true",
	"outputServices=generic-definitions", // output generic ServiceDefinitions
	"outputIndex=true", // output an index file for each package which exports all protos in the package.
	"useOptionals=none", // scalar and message fields are required unless they are marked as optional.
	"useDate=false", // Timestamp fields will not be automatically converted to Date.
]

async function main() {
	await cleanup()
	await compileProtos()
	await generateProtoBusSetup()
	await generateHostBridgeClient()
}
async function compileProtos() {
	console.log(chalk.bold.blue("Compiling Protocol Buffers..."))

	// Check for Apple Silicon compatibility before proceeding
	checkAppleSiliconCompatibility()

	// Create output directories if they don't exist
	for (const dir of [TS_OUT_DIR, GRPC_JS_OUT_DIR, NICE_JS_OUT_DIR, DESCRIPTOR_OUT_DIR]) {
		await fs.mkdir(dir, { recursive: true })
	}

	// Process all proto files
	const protoFiles = await globby("**/*.proto", { cwd: PROTO_DIR, realpath: true })
	console.log(chalk.cyan(`Processing ${protoFiles.length} proto files from`), PROTO_DIR)

	tsProtoc(TS_OUT_DIR, protoFiles, TS_PROTO_OPTIONS)
	// grpc-js is used to generate service impls for the ProtoBus service.
	tsProtoc(GRPC_JS_OUT_DIR, protoFiles, ["outputServices=grpc-js", ...TS_PROTO_OPTIONS])
	// nice-js is used for the Host Bridge client impls because it uses promises.
	tsProtoc(NICE_JS_OUT_DIR, protoFiles, ["outputServices=nice-grpc,useExactTypes=false", ...TS_PROTO_OPTIONS])

	const descriptorFile = path.join(DESCRIPTOR_OUT_DIR, "descriptor_set.pb")
	const descriptorProtocCommand = [
		PROTOC,
		`--proto_path="${PROTO_DIR}"`,
		`--descriptor_set_out="${descriptorFile}"`,
		"--include_imports",
		...protoFiles,
	].join(" ")
	try {
		log_verbose(chalk.cyan("Generating descriptor set..."))
		execSync(descriptorProtocCommand, { stdio: "inherit" })
	} catch (error) {
		console.error(chalk.red("Error generating descriptor set for proto file:"), error)
		process.exit(1)
	}

	log_verbose(chalk.green("Protocol Buffer code generation completed successfully."))
	log_verbose(chalk.green(`TypeScript files generated in: ${TS_OUT_DIR}`))
}

async function tsProtoc(outDir, protoFiles, protoOptions) {
	// Build the protoc command with proper path handling for cross-platform
	const command = [
		PROTOC,
		`--proto_path="${PROTO_DIR}"`,
		`--plugin=protoc-gen-ts_proto="${TS_PROTO_PLUGIN}"`,
		`--ts_proto_out="${outDir}"`,
		`--ts_proto_opt=${protoOptions.join(",")} `,
		...protoFiles.map((s) => `"${s}"`),
	].join(" ")
	try {
		log_verbose(chalk.cyan(`Generating TypeScript code in ${outDir} for:\n${protoFiles.join("\n")}...`))
		log_verbose(command)
		execSync(command, { stdio: "inherit" })
	} catch (error) {
		console.error(chalk.red("Error generating TypeScript for proto files:"), error)
		process.exit(1)
	}
}

async function cleanup() {
	// Clean up existing generated files
	log_verbose(chalk.cyan("Cleaning up existing generated TypeScript files..."))
	await rmrf(TS_OUT_DIR)
	await rmrf("src/generated")

	// Clean up generated files that were moved.
	await rmrf("src/standalone/services/host-grpc-client.ts")
	await rmrf("src/standalone/server-setup.ts")
	await rmrf("src/hosts/vscode/host-grpc-service-config.ts")
	await rmrf("src/core/controller/grpc-service-config.ts")
	const oldhostbridgefiles = [
		"src/hosts/vscode/workspace/methods.ts",
		"src/hosts/vscode/workspace/index.ts",
		"src/hosts/vscode/diff/methods.ts",
		"src/hosts/vscode/diff/index.ts",
		"src/hosts/vscode/env/methods.ts",
		"src/hosts/vscode/env/index.ts",
		"src/hosts/vscode/window/methods.ts",
		"src/hosts/vscode/window/index.ts",
		"src/hosts/vscode/watch/methods.ts",
		"src/hosts/vscode/watch/index.ts",
		"src/hosts/vscode/uri/methods.ts",
		"src/hosts/vscode/uri/index.ts",
	]
	const oldprotobusfiles = [
		"src/core/controller/account/index.ts",
		"src/core/controller/account/methods.ts",
		"src/core/controller/browser/index.ts",
		"src/core/controller/browser/methods.ts",
		"src/core/controller/checkpoints/index.ts",
		"src/core/controller/checkpoints/methods.ts",
		"src/core/controller/file/index.ts",
		"src/core/controller/file/methods.ts",
		"src/core/controller/mcp/index.ts",
		"src/core/controller/mcp/methods.ts",
		"src/core/controller/models/index.ts",
		"src/core/controller/models/methods.ts",
		"src/core/controller/slash/index.ts",
		"src/core/controller/slash/methods.ts",
		"src/core/controller/state/index.ts",
		"src/core/controller/state/methods.ts",
		"src/core/controller/task/index.ts",
		"src/core/controller/task/methods.ts",
		"src/core/controller/ui/index.ts",
		"src/core/controller/ui/methods.ts",
		"src/core/controller/web/index.ts",
		"src/core/controller/web/methods.ts",
	]
	for (const file of [...oldhostbridgefiles, ...oldprotobusfiles]) {
		await rmrf(file)
	}
}

// Check for Apple Silicon compatibility
function checkAppleSiliconCompatibility() {
	// Only run check on macOS
	if (process.platform !== "darwin") {
		return
	}

	// Check if running on Apple Silicon
	const cpuArchitecture = os.arch()
	if (cpuArchitecture === "arm64") {
		try {
			// Check if Rosetta is installed
			const rosettaCheck = execSync('/usr/bin/pgrep oahd || echo "NOT_INSTALLED"').toString().trim()

			if (rosettaCheck === "NOT_INSTALLED") {
				console.log(chalk.yellow("Detected Apple Silicon (ARM64) architecture."))
				console.log(
					chalk.red("Rosetta 2 is NOT installed. The npm version of protoc is not compatible with Apple Silicon."),
				)
				console.log(chalk.cyan("Please install Rosetta 2 using the following command:"))
				console.log(chalk.cyan("  softwareupdate --install-rosetta --agree-to-license"))
				console.log(chalk.red("Aborting build process."))
				process.exit(1)
			}
		} catch (_error) {
			console.log(chalk.yellow("Could not determine Rosetta installation status. Proceeding anyway."))
		}
	}
}

function log_verbose(s) {
	if (process.argv.includes("-v") || process.argv.includes("--verbose")) {
		console.log(s)
	}
}

// Run the main function
main().catch((error) => {
	console.error(chalk.red("Error:"), error)
	process.exit(1)
})
