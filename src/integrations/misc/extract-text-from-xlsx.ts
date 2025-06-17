import ExcelJS from "exceljs"

const ROW_LIMIT = 50000

function formatCellValue(cell: ExcelJS.Cell): string {
	const value = cell.value
	if (value === null || value === undefined) {
		return ""
	}

	// Handle error values (#DIV/0!, #N/A, etc.)
	if (typeof value === "object" && "error" in value) {
		return `[Error: ${value.error}]`
	}

	// Handle dates - ExcelJS can parse them as Date objects
	if (value instanceof Date) {
		return value.toISOString().split("T")[0]
	}

	// Handle rich text
	if (typeof value === "object" && "richText" in value) {
		return value.richText.map((rt) => rt.text).join("")
	}

	// Handle hyperlinks
	if (typeof value === "object" && "text" in value && "hyperlink" in value) {
		return `${value.text} (${value.hyperlink})`
	}

	// Handle formulas - get the calculated result
	if (typeof value === "object" && "formula" in value) {
		if ("result" in value && value.result !== undefined && value.result !== null) {
			return value.result.toString()
		} else {
			return `[Formula: ${value.formula}]`
		}
	}

	return value.toString()
}

export async function extractTextFromXLSX(filePathOrWorkbook: string | ExcelJS.Workbook): Promise<string> {
	let workbook: ExcelJS.Workbook
	let excelText = ""

	if (typeof filePathOrWorkbook === "string") {
		workbook = new ExcelJS.Workbook()
		await workbook.xlsx.readFile(filePathOrWorkbook)
	} else {
		workbook = filePathOrWorkbook
	}

	workbook.eachSheet((worksheet, sheetId) => {
		if (worksheet.state === "hidden" || worksheet.state === "veryHidden") {
			return
		}

		excelText += `--- Sheet: ${worksheet.name} ---\n`

		worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
			if (rowNumber > ROW_LIMIT) {
				excelText += `[... truncated at row ${rowNumber} ...]\n`
				return false
			}

			const rowTexts: string[] = []
			let hasContent = false

			row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
				const cellText = formatCellValue(cell)
				if (cellText.trim()) {
					hasContent = true
				}
				rowTexts.push(cellText)
			})

			if (hasContent) {
				excelText += rowTexts.join("\t") + "\n"
			}

			return true
		})

		excelText += "\n"
	})

	return excelText.trim()
}
