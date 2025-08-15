import { spawn, execSync, type ChildProcess } from "child_process"
import * as path from "path"
import * as fs from "fs"
import { fileURLToPath } from "url"
import { glob } from "glob"

// @ts-expect-error - TS1470: We only run this script with tsx so it will never
// compile to CJS and it's safe to ignore this tsc error.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface PackageConfig {
	readonly name: string
	readonly sourcePath: string
	readonly targetPaths: readonly string[]
	readonly replacePath?: string
	readonly npmPath: string
	readonly watchCommand?: string
	readonly watchOutput?: {
		readonly start: string[]
		readonly stop: string[]
	}
}

interface Config {
	readonly packages: readonly PackageConfig[]
}

interface WatcherResult {
	child: ChildProcess
}

interface NpmPackage {
	name?: string
	version?: string
	type: "module"
	dependencies: Record<string, string>
	main: string
	module: string
	types: string
	exports: {
		".": {
			types: string
			import: string
			require: {
				types: string
				default: string
			}
		}
	}
	files: string[]
}

const config: Config = {
	packages: [
		{
			name: "@roo-code/cloud",
			sourcePath: "../Roo-Code-Cloud/packages/sdk",
			targetPaths: ["src/node_modules/@roo-code/cloud"] as const,
			replacePath: "node_modules/.pnpm/@roo-code+cloud*",
			npmPath: "npm",
			watchCommand: "pnpm build:development:watch",
			watchOutput: {
				start: ["CLI Building", "CLI Change detected"],
				stop: ["DTS ⚡️ Build success"],
			},
		},
	],
} as const

const args = process.argv.slice(2)
const packageName = args.find((arg) => !arg.startsWith("--"))
const watchMode = !args.includes("--no-watch")
const unlink = args.includes("--unlink")

const packages: readonly PackageConfig[] = packageName
	? config.packages.filter((p) => p.name === packageName)
	: config.packages

if (!packages.length) {
	console.error(`Package '${packageName}' not found`)
	process.exit(1)
}

function pathExists(filePath: string): boolean {
	try {
		fs.accessSync(filePath)
		return true
	} catch {
		return false
	}
}

function copyRecursiveSync(src: string, dest: string): void {
	const exists = pathExists(src)

	if (!exists) {
		return
	}

	const stats = fs.statSync(src)
	const isDirectory = stats.isDirectory()

	if (isDirectory) {
		if (!pathExists(dest)) {
			fs.mkdirSync(dest, { recursive: true })
		}

		const children = fs.readdirSync(src)

		children.forEach((childItemName) => {
			copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName))
		})
	} else {
		fs.copyFileSync(src, dest)
	}
}

function generateNpmPackageJson(sourcePath: string, npmPath: string): string {
	const npmDir = path.join(sourcePath, npmPath)
	const npmPackagePath = path.join(npmDir, "package.json")
	const npmMetadataPath = path.join(npmDir, "package.metadata.json")
	const monorepoPackagePath = path.join(sourcePath, "package.json")

	if (pathExists(npmPackagePath)) {
		return npmPackagePath
	}

	if (!pathExists(npmMetadataPath)) {
		throw new Error(`No package.metadata.json found in ${npmDir}`)
	}

	const monorepoPackageContent = fs.readFileSync(monorepoPackagePath, "utf8")

	const monorepoPackage = JSON.parse(monorepoPackageContent) as {
		dependencies?: Record<string, string>
	}

	const npmMetadataContent = fs.readFileSync(npmMetadataPath, "utf8")
	const npmMetadata = JSON.parse(npmMetadataContent) as Partial<NpmPackage>

	const npmPackage: NpmPackage = {
		...npmMetadata,
		type: "module",
		dependencies: monorepoPackage.dependencies || {},
		main: "./dist/index.cjs",
		module: "./dist/index.js",
		types: "./dist/index.d.ts",
		exports: {
			".": {
				types: "./dist/index.d.ts",
				import: "./dist/index.js",
				require: {
					types: "./dist/index.d.cts",
					default: "./dist/index.cjs",
				},
			},
		},
		files: ["dist"],
	}

	fs.writeFileSync(npmPackagePath, JSON.stringify(npmPackage, null, 2) + "\n")

	return npmPackagePath
}

function linkPackage(pkg: PackageConfig): void {
	const sourcePath = path.resolve(__dirname, "..", pkg.sourcePath)

	if (!pathExists(sourcePath)) {
		console.error(`❌ Source not found: ${sourcePath}`)
		process.exit(1)
	}

	generateNpmPackageJson(sourcePath, pkg.npmPath)

	for (const currentTargetPath of pkg.targetPaths) {
		const targetPath = path.resolve(__dirname, "..", currentTargetPath)

		if (pathExists(targetPath)) {
			fs.rmSync(targetPath, { recursive: true, force: true })
		}

		const parentDir = path.dirname(targetPath)
		fs.mkdirSync(parentDir, { recursive: true })

		const linkSource = pkg.npmPath ? path.join(sourcePath, pkg.npmPath) : sourcePath
		copyRecursiveSync(linkSource, targetPath)
	}
}

function unlinkPackage(pkg: PackageConfig): void {
	for (const currentTargetPath of pkg.targetPaths) {
		const targetPath = path.resolve(__dirname, "..", currentTargetPath)

		if (pathExists(targetPath)) {
			fs.rmSync(targetPath, { recursive: true, force: true })
			console.log(`🗑️  Removed ${pkg.name} from ${currentTargetPath}`)
		}
	}
}

function startWatch(pkg: PackageConfig): WatcherResult {
	if (!pkg.watchCommand) {
		throw new Error(`Package ${pkg.name} has no watch command configured`)
	}

	const commandParts = pkg.watchCommand.split(" ")
	const [cmd, ...args] = commandParts

	if (!cmd) {
		throw new Error(`Invalid watch command for ${pkg.name}`)
	}

	console.log(`👀 Watching for changes to ${pkg.sourcePath} with ${cmd} ${args.join(" ")}`)

	const child = spawn(cmd, args, {
		cwd: path.resolve(__dirname, "..", pkg.sourcePath),
		stdio: "pipe",
		shell: true,
	})

	let debounceTimer: NodeJS.Timeout | null = null

	const DEBOUNCE_DELAY = 500

	if (child.stdout) {
		child.stdout.on("data", (data: Buffer) => {
			const output = data.toString()

			const isStarting = pkg.watchOutput?.start.some((start) => output.includes(start))

			const isDone = pkg.watchOutput?.stop.some((stop) => output.includes(stop))

			if (isStarting) {
				console.log(`🔨 Building ${pkg.name}...`)

				if (debounceTimer) {
					clearTimeout(debounceTimer)
					debounceTimer = null
				}
			}

			if (isDone) {
				console.log(`✅ Built ${pkg.name}`)

				if (debounceTimer) {
					clearTimeout(debounceTimer)
				}

				debounceTimer = setTimeout(() => {
					linkPackage(pkg)

					console.log(`♻️ Copied ${pkg.name} to ${pkg.targetPaths.length} paths\n`)

					debounceTimer = null
				}, DEBOUNCE_DELAY)
			}
		})
	}

	if (child.stderr) {
		child.stderr.on("data", (data: Buffer) => {
			console.log(`❌ "${data.toString()}"`)
		})
	}

	return { child }
}

function main(): void {
	if (unlink) {
		packages.forEach(unlinkPackage)

		console.log("\n📦 Restoring npm packages...")

		try {
			execSync("pnpm install", { cwd: __dirname, stdio: "ignore" })
			console.log("✅ npm packages restored")
		} catch (error) {
			console.error(`❌ Failed to restore packages: ${error instanceof Error ? error.message : String(error)}`)

			console.log("   Run 'pnpm install' manually if needed")
		}
	} else {
		packages.forEach((pkg) => {
			linkPackage(pkg)

			if (pkg.replacePath) {
				const replacePattern = path.resolve(__dirname, "..", pkg.replacePath)

				try {
					const matchedPaths = glob.sync(replacePattern)

					if (matchedPaths.length > 0) {
						matchedPaths.forEach((matchedPath: string) => {
							if (pathExists(matchedPath)) {
								fs.rmSync(matchedPath, { recursive: true, force: true })
								console.log(`🗑️  Removed ${pkg.name} from ${matchedPath}`)
							}
						})
					} else {
						if (pathExists(replacePattern)) {
							fs.rmSync(replacePattern, { recursive: true, force: true })
							console.log(`🗑️  Removed ${pkg.name} from ${replacePattern}`)
						}
					}
				} catch (error) {
					console.error(
						`❌ Error processing replace path: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}
		})

		if (watchMode) {
			const packagesWithWatch = packages.filter(
				(pkg): pkg is PackageConfig & { watchCommand: string } => pkg.watchCommand !== undefined,
			)

			const watchers = packagesWithWatch.map(startWatch)

			if (watchers.length > 0) {
				process.on("SIGINT", () => {
					console.log("\n👋 Stopping watchers...")

					watchers.forEach((w) => {
						if (w.child) {
							w.child.kill()
						}
					})

					process.exit(0)
				})
			}
		}
	}
}

main()
