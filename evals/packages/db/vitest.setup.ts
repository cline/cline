import fs from "node:fs/promises"
import path from "node:path"

import { execa } from "execa"

const TEST_DB_PATH = path.join(process.cwd(), "test.db")

export default async function () {
	const exists = await fs.stat(TEST_DB_PATH).catch(() => false)

	if (exists) {
		await fs.unlink(TEST_DB_PATH)
	}

	await execa({
		env: { BENCHMARKS_DB_PATH: `file:${TEST_DB_PATH}` },
	})`pnpm db:push`

	process.env.BENCHMARKS_DB_PATH = `file:${TEST_DB_PATH}`
}
