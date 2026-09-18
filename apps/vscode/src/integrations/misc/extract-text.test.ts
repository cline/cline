import { describe, it } from "bun:test"
import { expect } from "chai"
import ExcelJS from "exceljs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { extractTextFromExcel, MAX_EXCEL_ROWS } from "./extract-text"

/**
 * `Worksheet.eachRow` iterates with `forEach`, so a value returned from the
 * callback is discarded - it is not a "return false to break" API. The row cap
 * therefore has to be held with a flag; returning false left every row past the
 * cap appending another truncation notice.
 */
describe("extractTextFromFile - xlsx row cap", () => {
	async function writeWorkbook(rows: number): Promise<string> {
		const workbook = new ExcelJS.Workbook()
		const sheet = workbook.addWorksheet("Data")
		for (let row = 1; row <= rows; row++) {
			sheet.addRow([`r${row}c1`, `r${row}c2`])
		}
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-xlsx-"))
		const file = path.join(dir, "sheet.xlsx")
		await workbook.xlsx.writeFile(file)
		return file
	}

	it("emits at most one truncation notice past the cap", async () => {
		// Two rows past the cap: one notice is expected, not two.
		const file = await writeWorkbook(MAX_EXCEL_ROWS + 2)

		const text = await extractTextFromExcel(file)

		const notices = text.match(/\[\.\.\. truncated at row \d+ \.\.\.\]/g) ?? []
		expect(notices).to.have.lengthOf(1)
		expect(notices[0]).to.equal(`[... truncated at row ${MAX_EXCEL_ROWS + 1} ...]`)
	})

	it("keeps every row of a sheet under the cap", async () => {
		const file = await writeWorkbook(5)

		const text = await extractTextFromExcel(file)

		expect(text).to.contain("--- Sheet: Data ---")
		expect(text).to.contain("r1c1\tr1c2")
		expect(text).to.contain("r5c1\tr5c2")
		expect(text).to.not.contain("truncated at row")
	})
})
