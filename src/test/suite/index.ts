import * as path from "path"
import Mocha from "mocha"
import * as fs from "fs"
import { promisify } from "util"

const readdir = promisify(fs.readdir)
const stat = promisify(fs.stat)

async function findTestFiles(dir: string): Promise<string[]> {
	const files: string[] = []
	const entries = await readdir(dir)

	for (const entry of entries) {
		const fullPath = path.join(dir, entry)
		const stats = await stat(fullPath)

		if (stats.isDirectory()) {
			files.push(...(await findTestFiles(fullPath)))
		} else if (entry.endsWith(".test.js")) {
			files.push(fullPath)
		}
	}

	return files
}

export async function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: "bdd",
		color: true,
		timeout: 60000,
	})

	const testsRoot = path.resolve(__dirname, "..")
	const testFiles = await findTestFiles(testsRoot)

	// Add files to the test suite
	testFiles.forEach((file: string) => mocha.addFile(file))

	try {
		// Run the mocha test
		await new Promise<void>((resolve, reject) => {
			mocha.run((failures: number) => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`))
				} else {
					resolve()
				}
			})
		})
	} catch (err) {
		console.error(err)
		throw err
	}
}
