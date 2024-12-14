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
    })
})
