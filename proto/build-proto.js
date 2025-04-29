#!/usr/bin/env node

import * as fs from "fs/promises"
import * as path from "path"
import { execSync } from "child_process"
import { globby } from "globby"
import chalk from "chalk"

import { createRequire } from "module"
const require = createRequire(import.meta.url)
const protoc = path.join(require.resolve("grpc-tools"), "../bin/protoc")
const tsProtoPlugin = require.resolve("ts-proto/protoc-gen-ts_proto")

// Get script directory and root directory
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname)
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..")

async function main() {
	console.log(chalk.bold.blue("Starting Protocol Buffer code generation..."))

	// Define output directories
	const TS_OUT_DIR = path.join(ROOT_DIR, "src", "shared", "proto")

	// Create output directory if it doesn't exist
	await fs.mkdir(TS_OUT_DIR, { recursive: true })

	// Clean up existing generated files
	console.log(chalk.cyan("Cleaning up existing generated TypeScript files..."))
	const existingFiles = await globby("**/*.ts", { cwd: TS_OUT_DIR })
	for (const file of existingFiles) {
		await fs.unlink(path.join(TS_OUT_DIR, file))
	}

	// Process all proto files
	console.log(chalk.cyan("Processing proto files from"), SCRIPT_DIR)
	const protoFiles = await globby("*.proto", { cwd: SCRIPT_DIR })

	for (const protoFile of protoFiles) {
		console.log(chalk.cyan(`Generating TypeScript code for ${protoFile}...`))

		// Build the protoc command with proper path handling for cross-platform
		const protocCommand = [
			protoc,
			`--plugin=protoc-gen-ts_proto="${tsProtoPlugin}"`,
			`--ts_proto_out="${TS_OUT_DIR}"`,
			"--ts_proto_opt=outputServices=generic-definitions,env=node,esModuleInterop=true,useDate=false,useOptionals=messages",
			`--proto_path="${SCRIPT_DIR}"`,
			`"${path.join(SCRIPT_DIR, protoFile)}"`,
		].join(" ")

		try {
			const execOptions = {
				stdio: "inherit",
			}
			execSync(protocCommand, execOptions)
		} catch (error) {
			console.error(chalk.red(`Error generating TypeScript for ${protoFile}:`), error)
			process.exit(1)
		}
	}

	console.log(chalk.green("Protocol Buffer code generation completed successfully."))
	console.log(chalk.green(`TypeScript files generated in: ${TS_OUT_DIR}`))

	// Generate method registration files
	await generateMethodRegistrations()

	// Make the script executable
	try {
		await fs.chmod(path.join(SCRIPT_DIR, "build-proto.js"), 0o755)
	} catch (error) {
		console.warn(chalk.yellow("Warning: Could not make script executable:"), error)
	}
}

/**
 * Parse proto files to extract streaming method information
 * @param protoFiles Array of proto file names
 * @param scriptDir Directory containing proto files
 * @returns Map of service names to their streaming methods
 */
async function parseProtoForStreamingMethods(protoFiles, scriptDir) {
	console.log(chalk.cyan("Parsing proto files for streaming methods..."))

	// Map of service name to array of streaming method names
	const streamingMethodsMap = new Map()

	for (const protoFile of protoFiles) {
		const content = await fs.readFile(path.join(scriptDir, protoFile), "utf8")

		// Extract package name
		const packageMatch = content.match(/package\s+([^;]+);/)
		const packageName = packageMatch ? packageMatch[1].trim() : "unknown"

		// Extract service definitions
		const serviceMatches = Array.from(content.matchAll(/service\s+(\w+)\s*\{([^}]+)\}/g))
		for (const serviceMatch of serviceMatches) {
			const serviceName = serviceMatch[1]
			const serviceBody = serviceMatch[2]
			const fullServiceName = `${packageName}.${serviceName}`

			// Extract method definitions with streaming
			const methodMatches = Array.from(
				serviceBody.matchAll(/rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+)\s*\)/g),
			)

			const streamingMethods = []
			for (const methodMatch of methodMatches) {
				const methodName = methodMatch[1]
				const isRequestStreaming = !!methodMatch[2]
				const requestType = methodMatch[3]
				const isResponseStreaming = !!methodMatch[4]
				const responseType = methodMatch[5]

				if (isResponseStreaming) {
					streamingMethods.push({
						name: methodName,
						requestType,
						responseType,
						isRequestStreaming,
					})
				}
			}

			if (streamingMethods.length > 0) {
				streamingMethodsMap.set(fullServiceName, streamingMethods)
			}
		}
	}

	return streamingMethodsMap
}

async function generateMethodRegistrations() {
	console.log(chalk.cyan("Generating method registration files..."))

	const serviceDirs = [
		path.join(ROOT_DIR, "src", "core", "controller", "account"),
		path.join(ROOT_DIR, "src", "core", "controller", "browser"),
		path.join(ROOT_DIR, "src", "core", "controller", "checkpoints"),
		path.join(ROOT_DIR, "src", "core", "controller", "file"),
		path.join(ROOT_DIR, "src", "core", "controller", "mcp"),
		path.join(ROOT_DIR, "src", "core", "controller", "task"),
		// Add more service directories here as needed
	]

	// Parse proto files for streaming methods
	const protoFiles = await globby("*.proto", { cwd: SCRIPT_DIR })
	const streamingMethodsMap = await parseProtoForStreamingMethods(protoFiles, SCRIPT_DIR)

	for (const serviceDir of serviceDirs) {
		try {
			await fs.access(serviceDir)
		} catch (error) {
			console.log(chalk.gray(`Skipping ${serviceDir} - directory does not exist`))
			continue
		}

		const serviceName = path.basename(serviceDir)
		const registryFile = path.join(serviceDir, "methods.ts")

		// Determine the full service name for looking up streaming methods
		const serviceNameMap = {
			account: "cline.AccountService",
			browser: "cline.BrowserService",
			checkpoints: "cline.CheckpointsService",
			file: "cline.FileService",
			mcp: "cline.McpService",
			task: "cline.TaskService",
		}

		const fullServiceName = serviceNameMap[serviceName]
		const streamingMethods = streamingMethodsMap.get(fullServiceName) || []

		console.log(chalk.cyan(`Generating method registrations for ${serviceName}...`))

		// Get all TypeScript files in the service directory
		const files = await globby("*.ts", { cwd: serviceDir })

		// Filter out index.ts and methods.ts
		const implementationFiles = files.filter((file) => file !== "index.ts" && file !== "methods.ts")

		// Create the output file with header
		let content = `// AUTO-GENERATED FILE - DO NOT MODIFY DIRECTLY
// Generated by proto/build-proto.js

// Import all method implementations
import { registerMethod } from "./index"\n`

		// Add imports for all implementation files
		for (const file of implementationFiles) {
			const baseName = path.basename(file, ".ts")
			content += `import { ${baseName} } from "./${baseName}"\n`
		}

		// Add streaming methods information
		if (streamingMethods.length > 0) {
			content += `\n// Streaming methods for this service
export const streamingMethods = ${JSON.stringify(
				streamingMethods.map((m) => m.name),
				null,
				2,
			)}\n`
		}

		// Add registration function
		content += `\n// Register all ${serviceName} service methods
export function registerAllMethods(): void {
\t// Register each method with the registry\n`

		// Add registration statements
		for (const file of implementationFiles) {
			const baseName = path.basename(file, ".ts")
			const isStreaming = streamingMethods.some((m) => m.name === baseName)

			if (isStreaming) {
				content += `\tregisterMethod("${baseName}", ${baseName}, { isStreaming: true })\n`
			} else {
				content += `\tregisterMethod("${baseName}", ${baseName})\n`
			}
		}

		// Close the function
		content += `}`

		// Write the file
		await fs.writeFile(registryFile, content)
		console.log(chalk.green(`Generated ${registryFile}`))
	}

	console.log(chalk.green("Method registration files generated successfully."))
}

// Run the main function
main().catch((error) => {
	console.error(chalk.red("Error:"), error)
	process.exit(1)
})
