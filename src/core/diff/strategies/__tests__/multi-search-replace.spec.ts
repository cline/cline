import { MultiSearchReplaceDiffStrategy } from "../multi-search-replace"

describe("MultiSearchReplaceDiffStrategy", () => {
	describe("validateMarkerSequencing", () => {
		let strategy: MultiSearchReplaceDiffStrategy

		beforeEach(() => {
			strategy = new MultiSearchReplaceDiffStrategy()
		})

		it("validates correct marker sequence", () => {
			const diff = "<<<<<<< SEARCH\n" + "some content\n" + "=======\n" + "new content\n" + ">>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff).success).toBe(true)
		})

		it("validates correct marker sequence with extra > in SEARCH", () => {
			const diff = "<<<<<<< SEARCH>\n" + "some content\n" + "=======\n" + "new content\n" + ">>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff).success).toBe(true)
		})

		it("validates correct marker sequence with multiple > in SEARCH", () => {
			const diff = "<<<<<<< SEARCH>>\n" + "some content\n" + "=======\n" + "new content\n" + ">>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff).success).toBe(false)
		})

		it("validates mixed cases with and without extra > in the same diff", () => {
			const diff =
				"<<<<<<< SEARCH>\n" +
				"content1\n" +
				"=======\n" +
				"new1\n" +
				">>>>>>> REPLACE\n\n" +
				"<<<<<<< SEARCH\n" +
				"content2\n" +
				"=======\n" +
				"new2\n" +
				">>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff).success).toBe(true)
		})

		it("validates extra > with whitespace variations", () => {
			const diff1 = "<<<<<<< SEARCH>  \n" + "some content\n" + "=======\n" + "new content\n" + ">>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff1).success).toBe(true)

			const diff2 = "<<<<<<< SEARCH  >\n" + "some content\n" + "=======\n" + "new content\n" + ">>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff2).success).toBe(false)
		})

		it("validates extra > with line numbers", () => {
			const diff =
				"<<<<<<< SEARCH>\n" +
				":start_line:10\n" +
				"-------\n" +
				"content1\n" +
				"=======\n" +
				"new1\n" +
				">>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff).success).toBe(true)
		})

		it("validates multiple correct marker sequences", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content1\n" +
				"=======\n" +
				"new1\n" +
				">>>>>>> REPLACE\n\n" +
				"<<<<<<< SEARCH\n" +
				"content2\n" +
				"=======\n" +
				"new2\n" +
				">>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff).success).toBe(true)
		})

		it("validates multiple correct marker sequences with line numbers", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:10\n" +
				"-------\n" +
				"content1\n" +
				"=======\n" +
				"new1\n" +
				">>>>>>> REPLACE\n\n" +
				"<<<<<<< SEARCH\n" +
				":start_line:10\n" +
				"-------\n" +
				"content2\n" +
				"=======\n" +
				"new2\n" +
				">>>>>>> REPLACE"
			expect(strategy["validateMarkerSequencing"](diff).success).toBe(true)
		})

		it("detects separator before search", () => {
			const diff = "=======\n" + "content\n" + ">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("'=======' found in your diff content")
			expect(result.error).toContain("Diff block is malformed")
		})

		it("detects missing separator", () => {
			const diff = "<<<<<<< SEARCH\n" + "content\n" + ">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("'>>>>>>> REPLACE' found in your diff content")
			expect(result.error).toContain("Diff block is malformed")
		})

		it("detects two separators", () => {
			const diff = "<<<<<<< SEARCH\n" + "content\n" + "=======\n" + "=======\n" + ">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("'=======' found in your diff content")
			expect(result.error).toContain("When removing merge conflict markers")
		})

		it("detects replace before separator (merge conflict message)", () => {
			const diff = "<<<<<<< SEARCH\n" + "content\n" + ">>>>>>>"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("'>>>>>>>' found in your diff content")
			expect(result.error).toContain("When removing merge conflict markers")
		})

		it("detects incomplete sequence", () => {
			const diff = "<<<<<<< SEARCH\n" + "content\n" + "=======\n" + "new content"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("Expected '>>>>>>> REPLACE' was not found")
		})

		describe("exact matching", () => {
			let strategy: MultiSearchReplaceDiffStrategy

			beforeEach(() => {
				strategy = new MultiSearchReplaceDiffStrategy(1.0, 5) // Default 1.0 threshold for exact matching, 5 line buffer for tests
			})

			it("should replace matching content", async () => {
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe('function hello() {\n    console.log("hello world")\n}\n')
				}
			})

			it("should replace matching content in multiple blocks", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts
<<<<<<< SEARCH
function hello() {
=======
function helloWorld() {
>>>>>>> REPLACE
<<<<<<< SEARCH
    console.log("hello")
=======
    console.log("hello world")
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe('function helloWorld() {\n    console.log("hello world")\n}\n')
				}
			})

			it("should replace matching content in multiple blocks with line numbers", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts
<<<<<<< SEARCH
:start_line:1
-------
function hello() {
=======
function helloWorld() {
>>>>>>> REPLACE
<<<<<<< SEARCH
:start_line:2
-------
    console.log("hello")
=======
    console.log("hello world")
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe('function helloWorld() {\n    console.log("hello world")\n}\n')
				}
			})

			it("should replace matching content when end_line is passed in", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts
<<<<<<< SEARCH
:start_line:1
:end_line:1
-------
function hello() {
=======
function helloWorld() {
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe('function helloWorld() {\n    console.log("hello")\n}\n')
				}
			})

			it("should match content with different surrounding whitespace", async () => {
				const originalContent = "\nfunction example() {\n    return 42;\n}\n\n"
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe("\nfunction example() {\n    return 43;\n}\n\n")
				}
			})

			it("should match content with different indentation in search block", async () => {
				const originalContent = "    function test() {\n        return true;\n    }\n"
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe("    function test() {\n        return false;\n    }\n")
				}
			})

			it("should handle tab-based indentation", async () => {
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe("function test() {\n\treturn false;\n}\n")
				}
			})

			it("should preserve mixed tabs and spaces", async () => {
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(
						"\tclass Example {\n\t    constructor() {\n\t\tthis.value = 1;\n\t    }\n\t}",
					)
				}
			})

			it("should handle additional indentation with tabs", async () => {
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe("\tfunction test() {\n\t\t// Add comment\n\t\treturn false;\n\t}")
				}
			})

			it("should preserve exact indentation characters when adding lines", async () => {
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(
						"\tfunction test() {\n\t\t// First comment\n\t\t// Second comment\n\t\treturn true;\n\t}",
					)
				}
			})

			it("should handle Windows-style CRLF line endings", async () => {
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe("function test() {\r\n    return false;\r\n}\r\n")
				}
			})

			it("should return false if search content does not match", async () => {
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(false)
			})

			it("should return false if diff format is invalid", async () => {
				const originalContent = 'function hello() {\n    console.log("hello")\n}\n'
				const diffContent = `test.ts\nInvalid diff format`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(false)
			})

			it("should handle multiple lines with proper indentation", async () => {
				const originalContent =
					"class Example {\n    constructor() {\n        this.value = 0\n    }\n\n    getValue() {\n        return this.value\n    }\n}\n"
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(
						'class Example {\n    constructor() {\n        this.value = 0\n    }\n\n    getValue() {\n        // Add logging\n        console.log("Getting value")\n        return this.value\n    }\n}\n',
					)
				}
			})

			it("should preserve whitespace exactly in the output", async () => {
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe("    modified\n        still indented\n    end\n")
				}
			})

			it("should preserve indentation when adding new lines after existing content", async () => {
				const originalContent = "				onScroll={() => updateHighlights()}"
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

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(
						"				onScroll={() => updateHighlights()}\n				onDragOver={(e) => {\n					e.preventDefault()\n					e.stopPropagation()\n				}}",
					)
				}
			})

			it("should handle varying indentation levels correctly", async () => {
				const originalContent = `
class Example {
    constructor() {
        this.value = 0;
        if (true) {
            this.init();
        }
    }
}`.trim()

				const diffContent = `test.ts
<<<<<<< SEARCH
    class Example {
        constructor() {
            this.value = 0;
            if (true) {
                this.init();
            }
        }
    }
=======
    class Example {
        constructor() {
            this.value = 1;
            if (true) {
                this.init();
                this.setup();
                this.validate();
            }
        }
    }
>>>>>>> REPLACE`.trim()

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(
						`
class Example {
    constructor() {
        this.value = 1;
        if (true) {
            this.init();
            this.setup();
            this.validate();
        }
    }
}`.trim(),
					)
				}
			})

			it("should handle mixed indentation styles in the same file", async () => {
				const originalContent = `class Example {
    constructor() {
        this.value = 0;
        if (true) {
            this.init();
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
    constructor() {
        this.value = 0;
        if (true) {
        this.init();
        }
    }
=======
    constructor() {
        this.value = 1;
        if (true) {
        this.init();
        this.validate();
        }
    }
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(`class Example {
    constructor() {
        this.value = 1;
        if (true) {
        this.init();
        this.validate();
        }
    }
}`)
				}
			})

			it("should handle Python-style significant whitespace", async () => {
				const originalContent = `def example():
    if condition:
        do_something()
        for item in items:
            process(item)
    return True`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
    if condition:
        do_something()
        for item in items:
            process(item)
=======
    if condition:
        do_something()
        while items:
            item = items.pop()
            process(item)
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(`def example():
    if condition:
        do_something()
        while items:
            item = items.pop()
            process(item)
    return True`)
				}
			})

			it("should preserve empty lines with indentation", async () => {
				const originalContent = `function test() {
    const x = 1;
    
    if (x) {
        return true;
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
    const x = 1;
    
    if (x) {
=======
    const x = 1;
    
    // Check x
    if (x) {
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(`function test() {
    const x = 1;
    
    // Check x
    if (x) {
        return true;
    }
}`)
				}
			})

			it("should handle indentation when replacing entire blocks", async () => {
				const originalContent = `class Test {
    method() {
        if (true) {
            console.log("test");
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
    method() {
        if (true) {
            console.log("test");
        }
    }
=======
    method() {
        try {
            if (true) {
                console.log("test");
            }
        } catch (e) {
            console.error(e);
        }
    }
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(`class Test {
    method() {
        try {
            if (true) {
                console.log("test");
            }
        } catch (e) {
            console.error(e);
        }
    }
}`)
				}
			})

			it("should handle negative indentation relative to search content", async () => {
				const originalContent = `class Example {
    constructor() {
        if (true) {
            this.init();
            this.setup();
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
            this.init();
            this.setup();
=======
        this.init();
        this.setup();
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(`class Example {
    constructor() {
        if (true) {
        this.init();
        this.setup();
        }
    }
}`)
				}
			})

			it("should handle extreme negative indentation (no indent)", async () => {
				const originalContent = `class Example {
    constructor() {
        if (true) {
            this.init();
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
            this.init();
=======
this.init();
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(`class Example {
    constructor() {
        if (true) {
this.init();
        }
    }
}`)
				}
			})

			it("should handle mixed indentation changes in replace block", async () => {
				const originalContent = `class Example {
    constructor() {
        if (true) {
            this.init();
            this.setup();
            this.validate();
        }
    }
}`.trim()
				const diffContent = `test.ts
<<<<<<< SEARCH
            this.init();
            this.setup();
            this.validate();
=======
        this.init();
            this.setup();
    this.validate();
>>>>>>> REPLACE`

				const result = await strategy.applyDiff(originalContent, diffContent)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(`class Example {
    constructor() {
        if (true) {
        this.init();
            this.setup();
    this.validate();
        }
    }
}`)
				}
			})

			it("should find matches from middle out", async () => {
				const originalContent = `
function one() {
    return "target";
}

function two() {
    return "target";
}

function three() {
    return "target";
}

function four() {
    return "target";
}

function five() {
    return "target";
}`.trim()

				const diffContent = `test.ts
<<<<<<< SEARCH
    return "target";
=======
    return "updated";
>>>>>>> REPLACE`

				// Search around the middle (function three)
				// Even though all functions contain the target text,
				// it should match the one closest to line 9 first
				const result = await strategy.applyDiff(originalContent, diffContent, 9)
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.content).toBe(`function one() {
    return "target";
}

function two() {
    return "target";
}

function three() {
    return "updated";
}

function four() {
    return "target";
}

function five() {
    return "target";
}`)
				}
			})
		})
	})

	describe("fuzzy matching", () => {
		let strategy: MultiSearchReplaceDiffStrategy
		beforeEach(() => {
			strategy = new MultiSearchReplaceDiffStrategy(0.9, 5) // 90% similarity threshold, 5 line buffer for tests
		})

		it("should match content with small differences (>90% similar)", async () => {
			const originalContent =
				"function getData() {\n    const results = fetchData();\n    return results.filter(Boolean);\n}\n"
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

			strategy = new MultiSearchReplaceDiffStrategy(0.9, 5) // Use 5 line buffer for tests

			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe(
					"function getData() {\n    const data = fetchData();\n    return data.filter(Boolean);\n}\n",
				)
			}
		})

		it("should not match when content is too different (<90% similar)", async () => {
			const originalContent = "function processUsers(data) {\n    return data.map(user => user.name);\n}\n"
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

			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(false)
		})

		it("should match content with extra whitespace", async () => {
			const originalContent = "function sum(a, b) {\n    return a + b;\n}"
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

			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("function sum(a, b) {\n    return a + b + 1;\n}")
			}
		})

		it("should match content with smart quotes", async () => {
			const originalContent =
				"**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can't wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/RooCode/) or [Discord](https://discord.gg/roocode). Happy coding!"
			const diffContent = `test.ts
<<<<<<< SEARCH
**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can't wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/RooCode/) or [Discord](https://discord.gg/roocode). Happy coding!
=======
**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can't wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/RooCode/) or [Discord](https://discord.gg/roocode). Happy coding!

You're still here?
>>>>>>> REPLACE`

			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe(
					"**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can't wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/RooCode/) or [Discord](https://discord.gg/roocode). Happy coding!\n\nYou're still here?",
				)
			}
		})

		it("should not exact match empty lines", async () => {
			const originalContent = "function sum(a, b) {\n\n    return a + b;\n}"
			const diffContent = `test.ts
<<<<<<< SEARCH
function sum(a, b) {
=======
import { a } from "a";
function sum(a, b) {
>>>>>>> REPLACE`

			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe('import { a } from "a";\nfunction sum(a, b) {\n\n    return a + b;\n}')
			}
		})
	})

	describe("deletion", () => {
		let strategy: MultiSearchReplaceDiffStrategy

		beforeEach(() => {
			strategy = new MultiSearchReplaceDiffStrategy()
		})

		it("should delete code when replace block is empty", async () => {
			const originalContent = `function test() {
    console.log("hello");
    // Comment to remove
    console.log("world");
}`
			const diffContent = `test.ts
<<<<<<< SEARCH
    // Comment to remove
=======
>>>>>>> REPLACE`

			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe(`function test() {
    console.log("hello");
    console.log("world");
}`)
			}
		})

		it("should delete multiple lines when replace block is empty", async () => {
			const originalContent = `class Example {
    constructor() {
        // Initialize
        this.value = 0;
        // Set defaults
        this.name = "";
        // End init
    }
}`
			const diffContent = `test.ts
<<<<<<< SEARCH
        // Initialize
        this.value = 0;
        // Set defaults
        this.name = "";
        // End init
=======
>>>>>>> REPLACE`

			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe(`class Example {
    constructor() {
    }
}`)
			}
		})

		it("should preserve indentation when deleting nested code", async () => {
			const originalContent = `function outer() {
    if (true) {
        // Remove this
        console.log("test");
        // And this
    }
    return true;
}`
			const diffContent = `test.ts
<<<<<<< SEARCH
        // Remove this
        console.log("test");
        // And this
=======
>>>>>>> REPLACE`

			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe(`function outer() {
    if (true) {
    }
    return true;
}`)
			}
		})

		it("should delete a line when search block has line number prefix and replace is empty", async () => {
			const originalContent = "line 1\nline to delete\nline 3"
			const diffContent = `
<<<<<<< SEARCH
:start_line:2
-------
2 | line to delete
=======
>>>>>>> REPLACE`
			const result = await strategy.applyDiff(originalContent, diffContent)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("line 1\nline 3")
			}
		})
	})

	describe("getToolDescription", () => {
		let strategy: MultiSearchReplaceDiffStrategy

		beforeEach(() => {
			strategy = new MultiSearchReplaceDiffStrategy()
		})

		it("should include the current workspace directory", async () => {
			const cwd = "/test/dir"
			const description = await strategy.getToolDescription({ cwd })
			expect(description).toContain(`relative to the current workspace directory ${cwd}`)
		})

		it("should include required format elements", async () => {
			const description = await strategy.getToolDescription({ cwd: "/test" })
			expect(description).toContain("<<<<<<< SEARCH")
			expect(description).toContain("=======")
			expect(description).toContain(">>>>>>> REPLACE")
			expect(description).toContain("<apply_diff>")
			expect(description).toContain("</apply_diff>")
		})
	})

	describe("line marker validation in REPLACE sections", () => {
		let strategy: MultiSearchReplaceDiffStrategy

		beforeEach(() => {
			strategy = new MultiSearchReplaceDiffStrategy()
		})

		it("should reject start_line marker in REPLACE section", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content to find\n" +
				"=======\n" +
				":start_line:5\n" +
				"replacement content\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("Invalid line marker ':start_line:' found in REPLACE section")
			expect(result.error).toContain(
				"Line markers (:start_line: and :end_line:) are only allowed in SEARCH sections",
			)
		})

		it("should reject end_line marker in REPLACE section", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content to find\n" +
				"=======\n" +
				":end_line:10\n" +
				"replacement content\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("Invalid line marker ':end_line:' found in REPLACE section")
			expect(result.error).toContain(
				"Line markers (:start_line: and :end_line:) are only allowed in SEARCH sections",
			)
		})

		it("should reject both line markers in REPLACE section", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content to find\n" +
				"=======\n" +
				":start_line:5\n" +
				":end_line:10\n" +
				"replacement content\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("Invalid line marker ':start_line:' found in REPLACE section")
		})

		it("should reject line markers in multiple diff blocks where one has invalid markers", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:1\n" +
				"content1\n" +
				"=======\n" +
				"replacement1\n" +
				">>>>>>> REPLACE\n\n" +
				"<<<<<<< SEARCH\n" +
				"content2\n" +
				"=======\n" +
				":start_line:5\n" +
				"replacement2\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("Invalid line marker ':start_line:' found in REPLACE section")
		})

		it("should allow valid markers in SEARCH section with content in REPLACE", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:5\n" +
				":end_line:10\n" +
				"-------\n" +
				"content to find\n" +
				"=======\n" +
				"replacement content\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(true)
		})

		it("should allow escaped line markers in REPLACE content", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content to find\n" +
				"=======\n" +
				"replacement content\n" +
				"\\:start_line:5\n" +
				"more content\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(true)
		})

		it("should allow escaped end_line markers in REPLACE content", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content to find\n" +
				"=======\n" +
				"replacement content\n" +
				"\\:end_line:10\n" +
				"more content\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(true)
		})

		it("should allow both escaped line markers in REPLACE content", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content to find\n" +
				"=======\n" +
				"replacement content\n" +
				"\\:start_line:5\n" +
				"\\:end_line:10\n" +
				"more content\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(true)
		})

		it("should reject line markers with whitespace in REPLACE section", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content to find\n" +
				"=======\n" +
				"  :start_line:5  \n" +
				"replacement content\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("Invalid line marker ':start_line:' found in REPLACE section")
		})

		it("should reject line markers in middle of REPLACE content", () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"content to find\n" +
				"=======\n" +
				"some replacement\n" +
				":end_line:15\n" +
				"more replacement\n" +
				">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("Invalid line marker ':end_line:' found in REPLACE section")
		})

		it("should provide helpful error message format", () => {
			const diff =
				"<<<<<<< SEARCH\n" + "content\n" + "=======\n" + ":start_line:5\n" + "replacement\n" + ">>>>>>> REPLACE"
			const result = strategy["validateMarkerSequencing"](diff)
			expect(result.success).toBe(false)
			expect(result.error).toContain("CORRECT FORMAT:")
			expect(result.error).toContain("INCORRECT FORMAT:")
			expect(result.error).toContain(":start_line:5    <-- Invalid location")
		})
	})
})
