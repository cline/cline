import { SearchReplaceDiffStrategy } from '../search-replace'

describe('SearchReplaceDiffStrategy', () => {
    describe('exact matching', () => {
        let strategy: SearchReplaceDiffStrategy

        beforeEach(() => {
            strategy = new SearchReplaceDiffStrategy() // Default 1.0 threshold for exact matching
        })

        it('should replace matching content', () => {
            const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
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
            expect(result).toBe('function hello() {\n    console.log("hello world")\n}\n')
        })

        it('should match content with different surrounding whitespace', () => {
            const originalContent = '\nfunction example() {\n    return 42;\n}\n\n'
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
            expect(result).toBe('\nfunction example() {\n    return 43;\n}\n\n')
        })

        it('should match content with different indentation in search block', () => {
            const originalContent = '    function test() {\n        return true;\n    }\n'
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
            expect(result).toBe('    function test() {\n        return false;\n    }\n')
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
            const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
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
            const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
            const diffContent = `test.ts\nInvalid diff format`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(false)
        })

        it('should handle multiple lines with proper indentation', () => {
            const originalContent = 'class Example {\n    constructor() {\n        this.value = 0\n    }\n\n    getValue() {\n        return this.value\n    }\n}\n'
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
            expect(result).toBe('class Example {\n    constructor() {\n        this.value = 0\n    }\n\n    getValue() {\n        // Add logging\n        console.log("Getting value")\n        return this.value\n    }\n}\n')
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

        it('should preserve indentation when adding new lines after existing content', () => {
            const originalContent = '				onScroll={() => updateHighlights()}'
            const diffContent = `test.ts
<<<<<<< SEARCH
				onScroll={() => updateHighlights()}
=======
				onScroll={() => updateHighlights()}
				onDragOver={(e) => {
					e.preventDefault()
					e.stopPropagation()
				}}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe('				onScroll={() => updateHighlights()}\n				onDragOver={(e) => {\n					e.preventDefault()\n					e.stopPropagation()\n				}}')
        })
    })

    describe('fuzzy matching', () => {
        let strategy: SearchReplaceDiffStrategy

        beforeEach(() => {
            strategy = new SearchReplaceDiffStrategy(0.9) // 90% similarity threshold
        })

        it('should match content with small differences (>90% similar)', () => {
            const originalContent = 'function getData() {\n    const results = fetchData();\n    return results.filter(Boolean);\n}\n'
            const diffContent = `test.ts
<<<<<<< SEARCH
function getData() {
    const result = fetchData();
    return results.filter(Boolean);
}
=======
function getData() {
    const data = fetchData();
    return data.filter(Boolean);
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe('function getData() {\n    const data = fetchData();\n    return data.filter(Boolean);\n}\n')
        })

        it('should not match when content is too different (<90% similar)', () => {
            const originalContent = 'function processUsers(data) {\n    return data.map(user => user.name);\n}\n'
            const diffContent = `test.ts
<<<<<<< SEARCH
function handleItems(items) {
    return items.map(item => item.username);
}
=======
function processData(data) {
    return data.map(d => d.value);
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(false)
        })

        it('should match content with extra whitespace', () => {
            const originalContent = 'function sum(a, b) {\n    return a + b;\n}'
            const diffContent = `test.ts
<<<<<<< SEARCH
function   sum(a,   b)    {
    return    a + b;
}
=======
function sum(a, b) {
    return a + b + 1;
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe('function sum(a, b) {\n    return a + b + 1;\n}')
        })
    })

    describe('line-constrained search', () => {
        let strategy: SearchReplaceDiffStrategy

        beforeEach(() => {
            strategy = new SearchReplaceDiffStrategy()
        })

        it('should find and replace within specified line range', () => {
            const originalContent = `
function one() {
    return 1;
}

function two() {
    return 2;
}

function three() {
    return 3;
}
`.trim()
            const diffContent = `test.ts
<<<<<<< SEARCH
function two() {
    return 2;
}
=======
function two() {
    return "two";
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent, 5, 7)
            expect(result).toBe(`function one() {
    return 1;
}

function two() {
    return "two";
}

function three() {
    return 3;
}`)
        })

        it('should find and replace within buffer zone (5 lines before/after)', () => {
            const originalContent = `
function one() {
    return 1;
}

function two() {
    return 2;
}

function three() {
    return 3;
}
`.trim()
            const diffContent = `test.ts
<<<<<<< SEARCH
function three() {
    return 3;
}
=======
function three() {
    return "three";
}
>>>>>>> REPLACE`

            // Even though we specify lines 5-7, it should still find the match at lines 9-11
            // because it's within the 5-line buffer zone
            const result = strategy.applyDiff(originalContent, diffContent, 5, 7)
            expect(result).toBe(`function one() {
    return 1;
}

function two() {
    return 2;
}

function three() {
    return "three";
}`)
        })

        it('should not find matches outside search range and buffer zone', () => {
            const originalContent = `
function one() {
    return 1;
}

function two() {
    return 2;
}

function three() {
    return 3;
}

function four() {
    return 4;
}

function five() {
    return 5;
}
`.trim()
            const diffContent = `test.ts
<<<<<<< SEARCH
function five() {
    return 5;
}
=======
function five() {
    return "five";
}
>>>>>>> REPLACE`

            // Searching around function two() (lines 5-7)
            // function five() is more than 5 lines away, so it shouldn't match
            const result = strategy.applyDiff(originalContent, diffContent, 5, 7)
            expect(result).toBe(false)
        })

        it('should handle search range at start of file', () => {
            const originalContent = `
function one() {
    return 1;
}

function two() {
    return 2;
}
`.trim()
            const diffContent = `test.ts
<<<<<<< SEARCH
function one() {
    return 1;
}
=======
function one() {
    return "one";
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent, 1, 3)
            expect(result).toBe(`function one() {
    return "one";
}

function two() {
    return 2;
}`)
        })

        it('should handle search range at end of file', () => {
            const originalContent = `
function one() {
    return 1;
}

function two() {
    return 2;
}
`.trim()
            const diffContent = `test.ts
<<<<<<< SEARCH
function two() {
    return 2;
}
=======
function two() {
    return "two";
}
>>>>>>> REPLACE`

            const result = strategy.applyDiff(originalContent, diffContent, 5, 7)
            expect(result).toBe(`function one() {
    return 1;
}

function two() {
    return "two";
}`)
        })

        it('should match specific instance of duplicate code using line numbers', () => {
            const originalContent = `
function processData(data) {
    return data.map(x => x * 2);
}

function unrelatedStuff() {
    console.log("hello");
}

// Another data processor
function processData(data) {
    return data.map(x => x * 2);
}

function moreStuff() {
    console.log("world");
}
`.trim()
            const diffContent = `test.ts
<<<<<<< SEARCH
function processData(data) {
    return data.map(x => x * 2);
}
=======
function processData(data) {
    // Add logging
    console.log("Processing data...");
    return data.map(x => x * 2);
}
>>>>>>> REPLACE`

            // Target the second instance of processData
            const result = strategy.applyDiff(originalContent, diffContent, 10, 12)
            expect(result).toBe(`function processData(data) {
    return data.map(x => x * 2);
}

function unrelatedStuff() {
    console.log("hello");
}

// Another data processor
function processData(data) {
    // Add logging
    console.log("Processing data...");
    return data.map(x => x * 2);
}

function moreStuff() {
    console.log("world");
}`)
        })

        it('should search from start line to end of file when only start_line is provided', () => {
            const originalContent = `
function one() {
    return 1;
}

function two() {
    return 2;
}

function three() {
    return 3;
}
`.trim()
            const diffContent = `test.ts
<<<<<<< SEARCH
function three() {
    return 3;
}
=======
function three() {
    return "three";
}
>>>>>>> REPLACE`

            // Only provide start_line, should search from there to end of file
            const result = strategy.applyDiff(originalContent, diffContent, 8)
            expect(result).toBe(`function one() {
    return 1;
}

function two() {
    return 2;
}

function three() {
    return "three";
}`)
        })

        it('should search from start of file to end line when only end_line is provided', () => {
            const originalContent = `
function one() {
    return 1;
}

function two() {
    return 2;
}

function three() {
    return 3;
}
`.trim()
            const diffContent = `test.ts
<<<<<<< SEARCH
function one() {
    return 1;
}
=======
function one() {
    return "one";
}
>>>>>>> REPLACE`

            // Only provide end_line, should search from start of file to there
            const result = strategy.applyDiff(originalContent, diffContent, undefined, 4)
            expect(result).toBe(`function one() {
    return "one";
}

function two() {
    return 2;
}

function three() {
    return 3;
}`)
        })

        it('should prioritize exact line match over expanded search', () => {
            const originalContent = `
function one() {
    return 1;
}

function process() {
    return "old";
}

function process() {
    return "old";
}

function two() {
    return 2;
}`
            const diffContent = `test.ts
<<<<<<< SEARCH
function process() {
    return "old";
}
=======
function process() {
    return "new";
}
>>>>>>> REPLACE`

            // Should match the second instance exactly at lines 10-12
            // even though the first instance at 6-8 is within the expanded search range
            const result = strategy.applyDiff(originalContent, diffContent, 10, 12)
            expect(result).toBe(`
function one() {
    return 1;
}

function process() {
    return "old";
}

function process() {
    return "new";
}

function two() {
    return 2;
}`)
            })

        it('should fall back to expanded search only if exact match fails', () => {
            const originalContent = `
function one() {
    return 1;
}

function process() {
    return "target";
}

function two() {
    return 2;
}`.trim()
    const diffContent = `test.ts
<<<<<<< SEARCH
function process() {
    return "target";
}
=======
function process() {
    return "updated";
}
>>>>>>> REPLACE`

            // Specify wrong line numbers (3-5), but content exists at 6-8
            // Should still find and replace it since it's within the expanded range
            const result = strategy.applyDiff(originalContent, diffContent, 3, 5)
            expect(result).toBe(`function one() {
    return 1;
}

function process() {
    return "updated";
}

function two() {
    return 2;
}`)
        })
    })

    describe('getToolDescription', () => {
        let strategy: SearchReplaceDiffStrategy

        beforeEach(() => {
            strategy = new SearchReplaceDiffStrategy()
        })

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

        it('should document start_line and end_line parameters', () => {
            const description = strategy.getToolDescription('/test')
            expect(description).toContain('start_line: (required) The line number where the search block starts.')
            expect(description).toContain('end_line: (required) The line number where the search block ends.')
        })
    })
})
