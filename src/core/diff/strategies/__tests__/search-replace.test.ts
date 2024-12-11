import { SearchReplaceDiffStrategy } from '../search-replace'

describe('SearchReplaceDiffStrategy', () => {
    let strategy: SearchReplaceDiffStrategy

    beforeEach(() => {
        strategy = new SearchReplaceDiffStrategy()
    })

    describe('applyDiff', () => {
        it('should replace matching content', () => {
            const originalContent = `function hello() {
    console.log("hello")
}
`
            const diffContent = `test.ts
<<<<<<< SEARCH
function hello() {
    console.log("hello")
}
=======
function hello() {
    console.log("hello world")
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(`function hello() {
    console.log("hello world")
}
`)
        })

        it('should handle extra whitespace in search/replace blocks', () => {
            const originalContent = `function test() {
    return true;
}
`
            const diffContent = `test.ts
<<<<<<< SEARCH

function test() {
    return true;
}

=======
function test() {
    return false;
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(`function test() {
    return false;
}
`)
        })

        it('should match content with different surrounding whitespace', () => {
            const originalContent = `
function example() {
    return 42;
}

`
            const diffContent = `test.ts
<<<<<<< SEARCH
function example() {
    return 42;
}
=======
function example() {
    return 43;
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(`
function example() {
    return 43;
}

`)
        })

        it('should match content with different indentation in search block', () => {
            const originalContent = `    function test() {
        return true;
    }
`
            const diffContent = `test.ts
<<<<<<< SEARCH
function test() {
    return true;
}
=======
function test() {
    return false;
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(`    function test() {
        return false;
    }
`)
        })

        it('should handle tab-based indentation', () => {
            const originalContent = "function test() {\n\treturn true;\n}\n"
            const diffContent = `test.ts
<<<<<<< SEARCH
function test() {
\treturn true;
}
=======
function test() {
\treturn false;
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe("function test() {\n\treturn false;\n}\n")
        })

        it('should preserve mixed tabs and spaces', () => {
            const originalContent = "\tclass Example {\n\t    constructor() {\n\t\tthis.value = 0;\n\t    }\n\t}"
            const diffContent = `test.ts
<<<<<<< SEARCH
\tclass Example {
\t    constructor() {
\t\tthis.value = 0;
\t    }
\t}
=======
\tclass Example {
\t    constructor() {
\t\tthis.value = 1;
\t    }
\t}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe("\tclass Example {\n\t    constructor() {\n\t\tthis.value = 1;\n\t    }\n\t}")
        })

        it('should handle additional indentation with tabs', () => {
            const originalContent = "\tfunction test() {\n\t\treturn true;\n\t}"
            const diffContent = `test.ts
<<<<<<< SEARCH
function test() {
\treturn true;
}
=======
function test() {
\t// Add comment
\treturn false;
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe("\tfunction test() {\n\t\t// Add comment\n\t\treturn false;\n\t}")
        })

        it('should preserve exact indentation characters when adding lines', () => {
            const originalContent = "\tfunction test() {\n\t\treturn true;\n\t}"
            const diffContent = `test.ts
<<<<<<< SEARCH
\tfunction test() {
\t\treturn true;
\t}
=======
\tfunction test() {
\t\t// First comment
\t\t// Second comment
\t\treturn true;
\t}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe("\tfunction test() {\n\t\t// First comment\n\t\t// Second comment\n\t\treturn true;\n\t}")
        })

        it('should handle Windows-style CRLF line endings', () => {
            const originalContent = "function test() {\r\n    return true;\r\n}\r\n"
            const diffContent = `test.ts
<<<<<<< SEARCH
function test() {
    return true;
}
=======
function test() {
    return false;
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe("function test() {\r\n    return false;\r\n}\r\n")
        })

        it('should return false if search content does not match', () => {
            const originalContent = `function hello() {
    console.log("hello")
}
`
            const diffContent = `test.ts
<<<<<<< SEARCH
function hello() {
    console.log("wrong")
}
=======
function hello() {
    console.log("hello world")
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(false)
        })

        it('should return false if diff format is invalid', () => {
            const originalContent = `function hello() {
    console.log("hello")
}
`
            const diffContent = `test.ts
Invalid diff format`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(false)
        })

        it('should handle multiple lines with proper indentation', () => {
            const originalContent = `class Example {
    constructor() {
        this.value = 0
    }

    getValue() {
        return this.value
    }
}
`
            const diffContent = `test.ts
<<<<<<< SEARCH
    getValue() {
        return this.value
    }
=======
    getValue() {
        // Add logging
        console.log("Getting value")
        return this.value
    }
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(`class Example {
    constructor() {
        this.value = 0
    }

    getValue() {
        // Add logging
        console.log("Getting value")
        return this.value
    }
}
`)
        })

        it('should preserve whitespace exactly in the output', () => {
            const originalContent = "    indented\n        more indented\n    back\n"
            const diffContent = `test.ts
<<<<<<< SEARCH
    indented
        more indented
    back
=======
    modified
        still indented
    end
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe("    modified\n        still indented\n    end\n")
        })

        it('should handle complex refactoring with multiple functions', () => {
            const originalContent = `export async function extractTextFromFile(filePath: string): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (error) {
		throw new Error(\`File not found: \${filePath}\`)
	}
	const fileExtension = path.extname(filePath).toLowerCase()
	switch (fileExtension) {
		case ".pdf":
			return extractTextFromPDF(filePath)
		case ".docx":
			return extractTextFromDOCX(filePath)
		case ".ipynb":
			return extractTextFromIPYNB(filePath)
		default:
			const isBinary = await isBinaryFile(filePath).catch(() => false)
			if (!isBinary) {
				return addLineNumbers(await fs.readFile(filePath, "utf8"))
			} else {
				throw new Error(\`Cannot read text for file type: \${fileExtension}\`)
			}
	}
}

export function addLineNumbers(content: string): string {
	const lines = content.split('\\n')
	const maxLineNumberWidth = String(lines.length).length
	return lines
		.map((line, index) => {
			const lineNumber = String(index + 1).padStart(maxLineNumberWidth, ' ')
			return \`\${lineNumber} | \${line}\`
		}).join('\\n')
}`

            const diffContent = `test.ts
<<<<<<< SEARCH
export async function extractTextFromFile(filePath: string): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (error) {
		throw new Error(\`File not found: \${filePath}\`)
	}
	const fileExtension = path.extname(filePath).toLowerCase()
	switch (fileExtension) {
		case ".pdf":
			return extractTextFromPDF(filePath)
		case ".docx":
			return extractTextFromDOCX(filePath)
		case ".ipynb":
			return extractTextFromIPYNB(filePath)
		default:
			const isBinary = await isBinaryFile(filePath).catch(() => false)
			if (!isBinary) {
				return addLineNumbers(await fs.readFile(filePath, "utf8"))
			} else {
				throw new Error(\`Cannot read text for file type: \${fileExtension}\`)
			}
	}
}

export function addLineNumbers(content: string): string {
	const lines = content.split('\\n')
	const maxLineNumberWidth = String(lines.length).length
	return lines
		.map((line, index) => {
			const lineNumber = String(index + 1).padStart(maxLineNumberWidth, ' ')
			return \`\${lineNumber} | \${line}\`
		}).join('\\n')
}
=======
function extractLineRange(content: string, startLine?: number, endLine?: number): string {
	const lines = content.split('\\n')
	const start = startLine ? Math.max(1, startLine) : 1
	const end = endLine ? Math.min(lines.length, endLine) : lines.length
	
	if (start > end || start > lines.length) {
		throw new Error(\`Invalid line range: start=\${start}, end=\${end}, total lines=\${lines.length}\`)
	}
	
	return lines.slice(start - 1, end).join('\\n')
}

export async function extractTextFromFile(filePath: string, startLine?: number, endLine?: number): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (error) {
		throw new Error(\`File not found: \${filePath}\`)
	}
	const fileExtension = path.extname(filePath).toLowerCase()
	let content: string
	
	switch (fileExtension) {
		case ".pdf": {
			const dataBuffer = await fs.readFile(filePath)
			const data = await pdf(dataBuffer)
			content = extractLineRange(data.text, startLine, endLine)
			break
		}
		case ".docx": {
			const result = await mammoth.extractRawText({ path: filePath })
			content = extractLineRange(result.value, startLine, endLine)
			break
		}
		case ".ipynb": {
			const data = await fs.readFile(filePath, "utf8")
			const notebook = JSON.parse(data)
			let extractedText = ""
			
			for (const cell of notebook.cells) {
				if ((cell.cell_type === "markdown" || cell.cell_type === "code") && cell.source) {
					extractedText += cell.source.join("\\n") + "\\n"
				}
			}
			content = extractLineRange(extractedText, startLine, endLine)
			break
		}
		default: {
			const isBinary = await isBinaryFile(filePath).catch(() => false)
			if (!isBinary) {
				const fileContent = await fs.readFile(filePath, "utf8")
				content = extractLineRange(fileContent, startLine, endLine)
			} else {
				throw new Error(\`Cannot read text for file type: \${fileExtension}\`)
			}
		}
	}
	
	return addLineNumbers(content, startLine)
}

export function addLineNumbers(content: string, startLine: number = 1): string {
	const lines = content.split('\\n')
	const maxLineNumberWidth = String(startLine + lines.length - 1).length
	return lines
		.map((line, index) => {
			const lineNumber = String(startLine + index).padStart(maxLineNumberWidth, ' ')
			return \`\${lineNumber} | \${line}\`
		}).join('\\n')
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            const expected = `function extractLineRange(content: string, startLine?: number, endLine?: number): string {
	const lines = content.split('\\n')
	const start = startLine ? Math.max(1, startLine) : 1
	const end = endLine ? Math.min(lines.length, endLine) : lines.length
	
	if (start > end || start > lines.length) {
		throw new Error(\`Invalid line range: start=\${start}, end=\${end}, total lines=\${lines.length}\`)
	}
	
	return lines.slice(start - 1, end).join('\\n')
}

export async function extractTextFromFile(filePath: string, startLine?: number, endLine?: number): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (error) {
		throw new Error(\`File not found: \${filePath}\`)
	}
	const fileExtension = path.extname(filePath).toLowerCase()
	let content: string
	
	switch (fileExtension) {
		case ".pdf": {
			const dataBuffer = await fs.readFile(filePath)
			const data = await pdf(dataBuffer)
			content = extractLineRange(data.text, startLine, endLine)
			break
		}
		case ".docx": {
			const result = await mammoth.extractRawText({ path: filePath })
			content = extractLineRange(result.value, startLine, endLine)
			break
		}
		case ".ipynb": {
			const data = await fs.readFile(filePath, "utf8")
			const notebook = JSON.parse(data)
			let extractedText = ""
			
			for (const cell of notebook.cells) {
				if ((cell.cell_type === "markdown" || cell.cell_type === "code") && cell.source) {
					extractedText += cell.source.join("\\n") + "\\n"
				}
			}
			content = extractLineRange(extractedText, startLine, endLine)
			break
		}
		default: {
			const isBinary = await isBinaryFile(filePath).catch(() => false)
			if (!isBinary) {
				const fileContent = await fs.readFile(filePath, "utf8")
				content = extractLineRange(fileContent, startLine, endLine)
			} else {
				throw new Error(\`Cannot read text for file type: \${fileExtension}\`)
			}
		}
	}
	
	return addLineNumbers(content, startLine)
}

export function addLineNumbers(content: string, startLine: number = 1): string {
	const lines = content.split('\\n')
	const maxLineNumberWidth = String(startLine + lines.length - 1).length
	return lines
		.map((line, index) => {
			const lineNumber = String(startLine + index).padStart(maxLineNumberWidth, ' ')
			return \`\${lineNumber} | \${line}\`
		}).join('\\n')
}`
            expect(result).toBe(expected)
        })
    })

    describe('getToolDescription', () => {
        it('should include the current working directory', () => {
            const cwd = '/test/dir'
            const description = strategy.getToolDescription(cwd)
            expect(description).toContain(`relative to the current working directory ${cwd}`)
        })

        it('should include required format elements', () => {
            const description = strategy.getToolDescription('/test')
            expect(description).toContain('<<<<<<< SEARCH')
            expect(description).toContain('=======')
            expect(description).toContain('>>>>>>> REPLACE')
            expect(description).toContain('<apply_diff>')
            expect(description).toContain('</apply_diff>')
        })
    })
})
