import { detectCodeOmission } from '../detect-omission'

describe('detectCodeOmission', () => {
	const originalContent = `function example() {
  // Some code
  const x = 1;
  const y = 2;
  return x + y;
}`

	it('should skip square bracket checks for files under 100 lines', () => {
		const newContent = `[Previous content from line 1-305 remains exactly the same]
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})

	it('should skip single-line comment checks for files under 100 lines', () => {
		const newContent = `// Lines 1-50 remain unchanged
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})

	it('should skip multi-line comment checks for files under 100 lines', () => {
		const newContent = `/* Previous content remains the same */
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})

	it('should skip HTML-style comment checks for files under 100 lines', () => {
		const newContent = `<!-- Existing content unchanged -->
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})

	it('should skip JSX-style comment checks for files under 100 lines', () => {
		const newContent = `{/* Rest of the code remains the same */}
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})

	it('should skip Python-style comment checks for files under 100 lines', () => {
		const newContent = `# Previous content remains unchanged
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})

	it('should not detect regular comments without omission keywords', () => {
		const newContent = `// Adding new functionality
const z = 3;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})

	it('should not detect when comment is part of original content', () => {
		const originalWithComment = `// Content remains unchanged
${originalContent}`
		const newContent = `// Content remains unchanged
const z = 3;`
		expect(detectCodeOmission(originalWithComment, newContent)).toBe(false)
	})

	it('should not detect code that happens to contain omission keywords', () => {
		const newContent = `const remains = 'some value';
const unchanged = true;`
		expect(detectCodeOmission(originalContent, newContent)).toBe(false)
	})

	describe('with predicted line count', () => {
		describe('length-based detection', () => {
			it('should skip length checks for files under 100 lines', () => {
				const newContent = `const x = 1;`
				const predictedLineCount = 50 // Less than 100 lines
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
			})

			it('should detect truncation for files with exactly 100 lines', () => {
				const newContent = `const x = 1;`
				const predictedLineCount = 100 // Exactly 100 lines
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
			})

			it('should detect truncation for files with more than 100 lines', () => {
				const newContent = `const x = 1;`
				const predictedLineCount = 150 // More than 100 lines
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
			})
		})

		describe('comment-based detection for large files', () => {
			const generateLongContent = (commentLine: string) => {
				return `${commentLine}
${Array.from({ length: 90 }, (_, i) => `const x${i} = ${i};`).join('\n')}
const y = 2;`
			}

			it('should detect suspicious single-line comment when content is more than 15% shorter', () => {
				const newContent = `// Previous content remains here
const x = 1;`
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
			})

			it('should not flag suspicious single-line comment when content is less than 15% shorter', () => {
				const newContent = generateLongContent('// Previous content remains here')
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
			})

			it('should detect suspicious Python-style comment when content is more than 15% shorter', () => {
				const newContent = `# Previous content remains here
const x = 1;`
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
			})

			it('should not flag suspicious Python-style comment when content is less than 15% shorter', () => {
				const newContent = generateLongContent('# Previous content remains here')
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
			})

			it('should detect suspicious multi-line comment when content is more than 15% shorter', () => {
				const newContent = `/* Previous content remains the same */
const x = 1;`
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
			})

			it('should not flag suspicious multi-line comment when content is less than 15% shorter', () => {
				const newContent = generateLongContent('/* Previous content remains the same */')
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
			})

			it('should detect suspicious JSX comment when content is more than 15% shorter', () => {
				const newContent = `{/* Rest of the code remains the same */}
const x = 1;`
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
			})

			it('should not flag suspicious JSX comment when content is less than 15% shorter', () => {
				const newContent = generateLongContent('{/* Rest of the code remains the same */}')
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
			})

			it('should detect suspicious HTML comment when content is more than 15% shorter', () => {
				const newContent = `<!-- Existing content unchanged -->
const x = 1;`
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
			})

			it('should not flag suspicious HTML comment when content is less than 15% shorter', () => {
				const newContent = generateLongContent('<!-- Existing content unchanged -->')
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
			})

			it('should detect suspicious square bracket notation when content is more than 15% shorter', () => {
				const newContent = `[Previous content from line 1-305 remains exactly the same]
const x = 1;`
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(true)
			})

			it('should not flag suspicious square bracket notation when content is less than 15% shorter', () => {
				const newContent = generateLongContent('[Previous content from line 1-305 remains exactly the same]')
				const predictedLineCount = 100
				expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
			})
		})

		it('should not flag content very close to predicted length', () => {
			const newContent = `const x = 1;
const y = 2;
// This is a legitimate comment that remains here`
			const predictedLineCount = newContent.split('\n').length // Exact line count match
			expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
		})

		it('should not flag when content is longer than predicted', () => {
			const newContent = `const x = 1;
const y = 2;
// Previous content remains here but we added more
const z = 3;
const w = 4;`
			const predictedLineCount = 3 // Content has 4 lines (longer than predicted)
			expect(detectCodeOmission(originalContent, newContent, predictedLineCount)).toBe(false)
		})
	})
})