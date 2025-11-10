import { expect } from "chai"
import { DiffError, type PatchAction, PatchActionType } from "@/shared/Patch"
import { PatchParser } from "../PatchParser"

describe("PatchParser", () => {
	describe("Parsing Logic", () => {
		interface TestCase {
			name: string
			patchLines: string[]
			currentFiles: Record<string, string>
			expectedActions?: Record<string, PatchAction>
			expectedError?: string | RegExp
			expectedFuzz?: number
		}

		const testCases: TestCase[] = [
			// Basic UPDATE operations
			{
				name: "simple update with exact match",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					" function hello() {",
					"-  console.log('old')",
					"+  console.log('new')",
					" }",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "function hello() {\n  console.log('old')\n}",
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 1,
								delLines: ["  console.log('old')"],
								insLines: ["  console.log('new')"],
							},
						],
					},
				},
				expectedFuzz: 0,
			},

			// Escaped/unescaped quote handling
			{
				name: "update with escaped backticks in patch, unescaped in file",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					" function test() {",
					"-  const str = \\`hello\\`",
					"+  const str = \\`world\\`",
					" }",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "function test() {\n  const str = `hello`\n}",
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 1,
								delLines: ["  const str = \\`hello\\`"],
								insLines: ["  const str = \\`world\\`"],
							},
						],
					},
				},
			},

			{
				name: "update with escaped single quotes in patch, unescaped in file",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					" function test() {",
					"-  const str = \\'hello\\'",
					"+  const str = \\'world\\'",
					" }",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "function test() {\n  const str = 'hello'\n}",
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 1,
								delLines: ["  const str = \\'hello\\'"],
								insLines: ["  const str = \\'world\\'"],
							},
						],
					},
				},
			},

			{
				name: "update with escaped double quotes in patch, unescaped in file",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					" function test() {",
					'-  const str = \\"hello\\"',
					'+  const str = \\"world\\"',
					" }",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": 'function test() {\n  const str = "hello"\n}',
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 1,
								delLines: ['  const str = \\"hello\\"'],
								insLines: ['  const str = \\"world\\"'],
							},
						],
					},
				},
			},

			// @@ context marker tests
			{
				name: "update with @@ context marker",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@ class MyClass",
					" method() {",
					"-    oldCode()",
					"+    newCode()",
					" }",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "class MyClass {\n  method() {\n    oldCode()\n  }\n}",
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 2,
								delLines: ["    oldCode()"],
								insLines: ["    newCode()"],
							},
						],
					},
				},
			},

			// Fuzzy matching tests
			{
				name: "update with trailing whitespace differences",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					" function test() {  ",
					"-  return 1",
					"+  return 2",
					" }",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "function test() {\n  return 1\n}",
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 1,
								delLines: ["  return 1"],
								insLines: ["  return 2"],
							},
						],
					},
				},
				// Fuzz is 1 because of trailing whitespace differences
				expectedFuzz: 1,
			},

			// ADD operations
			{
				name: "add new file",
				patchLines: [
					"*** Begin Patch",
					"*** Add File: new.ts",
					"+export function newFunc() {",
					"+  return 'hello'",
					"+}",
					"*** End Patch",
				],
				currentFiles: {},
				expectedActions: {
					"new.ts": {
						type: PatchActionType.ADD,
						newFile: "export function newFunc() {\n  return 'hello'\n}",
						chunks: [],
					},
				},
			},

			// DELETE operations
			{
				name: "delete file",
				patchLines: ["*** Begin Patch", "*** Delete File: old.ts", "*** End Patch"],
				currentFiles: {
					"old.ts": "// old file content",
				},
				expectedActions: {
					"old.ts": {
						type: PatchActionType.DELETE,
						chunks: [],
					},
				},
			},

			// Multiple chunks
			{
				name: "update with multiple chunks",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					" function func1() {",
					"-  old1()",
					"+  new1()",
					" }",
					"@@",
					" function func2() {",
					"-  old2()",
					"+  new2()",
					" }",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "function func1() {\n  old1()\n}\nfunction func2() {\n  old2()\n}",
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 1,
								delLines: ["  old1()"],
								insLines: ["  new1()"],
							},
							{
								origIndex: 4,
								delLines: ["  old2()"],
								insLines: ["  new2()"],
							},
						],
					},
				},
			},

			// EOF marker tests
			{
				name: "update with EOF marker",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					" }",
					"-// old comment",
					"+// new comment",
					"*** End of File",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "function test() {\n  return 1\n}\n// old comment",
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 3,
								delLines: ["// old comment"],
								insLines: ["// new comment"],
							},
						],
					},
				},
			},

			// Error cases
			{
				name: "error: update missing file",
				patchLines: ["*** Begin Patch", "*** Update File: missing.ts", "@@", "-old", "+new", "*** End Patch"],
				currentFiles: {},
				expectedError: /Missing File: missing.ts/,
			},

			{
				name: "error: delete missing file",
				patchLines: ["*** Begin Patch", "*** Delete File: missing.ts", "*** End Patch"],
				currentFiles: {},
				expectedError: /Missing File: missing.ts/,
			},

			{
				name: "error: add existing file",
				patchLines: ["*** Begin Patch", "*** Add File: existing.ts", "+content", "*** End Patch"],
				currentFiles: {
					"existing.ts": "old content",
				},
				expectedError: /File already exists: existing.ts/,
			},

			{
				name: "graceful handling: invalid context with warning",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					" nonexistent context",
					"-old",
					"+new",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "function test() {\n  return 1\n}",
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [], // No chunks applied due to invalid context
					},
				},
				// Should have warnings but not throw
			},

			{
				name: "error: duplicate update",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					"-old",
					"+new",
					"*** Update File: test.ts",
					"@@",
					"-old2",
					"+new2",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "old\nold2",
				},
				expectedError: /Duplicate update/,
			},

			{
				name: "error: unknown patch marker",
				patchLines: ["*** Begin Patch", "*** Unknown: test.ts", "*** End Patch"],
				currentFiles: {},
				expectedError: /Unknown line while parsing/,
			},

			// Move operation
			{
				name: "update with move",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: old.ts",
					"*** Move to: new.ts",
					"@@",
					" content",
					"-old",
					"+new",
					"*** End Patch",
				],
				currentFiles: {
					"old.ts": "content\nold",
				},
				expectedActions: {
					"old.ts": {
						type: PatchActionType.UPDATE,
						movePath: "new.ts",
						chunks: [
							{
								origIndex: 1,
								delLines: ["old"],
								insLines: ["new"],
							},
						],
					},
				},
			},

			// Mixed operations
			{
				name: "mixed add, update, and delete",
				patchLines: [
					"*** Begin Patch",
					"*** Add File: new.ts",
					"+new content",
					"*** Update File: existing.ts",
					"@@",
					"-old",
					"+new",
					"*** Delete File: old.ts",
					"*** End Patch",
				],
				currentFiles: {
					"existing.ts": "old",
					"old.ts": "to delete",
				},
				expectedActions: {
					"new.ts": {
						type: PatchActionType.ADD,
						newFile: "new content",
						chunks: [],
					},
					"existing.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 0,
								delLines: ["old"],
								insLines: ["new"],
							},
						],
					},
					"old.ts": {
						type: PatchActionType.DELETE,
						chunks: [],
					},
				},
			},

			// Context without leading space (tolerant parsing)
			{
				name: "context lines without leading space",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: test.ts",
					"@@",
					"function test() {",
					"-  old",
					"+  new",
					"}",
					"*** End Patch",
				],
				currentFiles: {
					"test.ts": "function test() {\n  old\n}",
				},
				expectedActions: {
					"test.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 1,
								delLines: ["  old"],
								insLines: ["  new"],
							},
						],
					},
				},
			},

			// V4A Format: 3 lines of context above
			{
				name: "update with 3 lines of context above (V4A format)",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: server.ts",
					"@@",
					" function processRequest(req: Request) {",
					"   const data = parseRequest(req)",
					"   const validated = validateData(data)",
					"-  return oldHandler(validated)",
					"+  return newHandler(validated)",
					"*** End Patch",
				],
				currentFiles: {
					"server.ts":
						"function processRequest(req: Request) {\n  const data = parseRequest(req)\n  const validated = validateData(data)\n  return oldHandler(validated)\n}",
				},
				expectedActions: {
					"server.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 3,
								delLines: ["  return oldHandler(validated)"],
								insLines: ["  return newHandler(validated)"],
							},
						],
					},
				},
			},

			// V4A Format: 3 lines of context above and below
			{
				name: "update with 3 lines of context above and below (V4A format)",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: calculator.ts",
					"@@",
					" export class Calculator {",
					"   constructor(private precision: number) {}",
					"   ",
					"-  calculate(a: number, b: number): number {",
					"-    return a + b",
					"+  calculate(a: number, b: number): Decimal {",
					"+    return new Decimal(a).plus(b)",
					"   }",
					"   ",
					"   getPrecision(): number {",
					"*** End Patch",
				],
				currentFiles: {
					"calculator.ts":
						"export class Calculator {\n  constructor(private precision: number) {}\n  \n  calculate(a: number, b: number): number {\n    return a + b\n  }\n  \n  getPrecision(): number {\n    return this.precision\n  }\n}",
				},
				expectedActions: {
					"calculator.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 3,
								delLines: ["  calculate(a: number, b: number): number {", "    return a + b"],
								insLines: ["  calculate(a: number, b: number): Decimal {", "    return new Decimal(a).plus(b)"],
							},
						],
					},
				},
			},

			// V4A Format: Multiple changes with 3 lines context
			{
				name: "multiple changes with 3 lines context each (V4A format)",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: service.ts",
					"@@",
					" export class DataService {",
					"   private cache: Map<string, any>",
					"   ",
					"-  constructor() {",
					"-    this.cache = new Map()",
					"+  constructor(private config: Config) {",
					"+    this.cache = new LRUCache(config.cacheSize)",
					"   }",
					"   ",
					"   async fetchData(key: string) {",
					"@@",
					"     if (this.cache.has(key)) {",
					"       return this.cache.get(key)",
					"     }",
					"-    const data = await this.loadFromApi(key)",
					"+    const data = await this.loadFromApiWithRetry(key)",
					"     this.cache.set(key, data)",
					"     return data",
					"   }",
					"*** End Patch",
				],
				currentFiles: {
					"service.ts":
						"export class DataService {\n  private cache: Map<string, any>\n  \n  constructor() {\n    this.cache = new Map()\n  }\n  \n  async fetchData(key: string) {\n    if (this.cache.has(key)) {\n      return this.cache.get(key)\n    }\n    const data = await this.loadFromApi(key)\n    this.cache.set(key, data)\n    return data\n  }\n}",
				},
				expectedActions: {
					"service.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 3,
								delLines: ["  constructor() {", "    this.cache = new Map()"],
								insLines: [
									"  constructor(private config: Config) {",
									"    this.cache = new LRUCache(config.cacheSize)",
								],
							},
							{
								origIndex: 11,
								delLines: ["    const data = await this.loadFromApi(key)"],
								insLines: ["    const data = await this.loadFromApiWithRetry(key)"],
							},
						],
					},
				},
			},

			// V4A Format: @@ with class context plus 3 lines
			{
				name: "update with @@ class marker and 3 lines context (V4A format)",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: models.ts",
					"@@ class UserModel",
					" ",
					"   async save(): Promise<void> {",
					"     await validateUser(this)",
					"-    await db.insert('users', this.toJSON())",
					"+    await db.upsert('users', this.id, this.toJSON())",
					"     this.emit('saved')",
					"   }",
					" ",
					"*** End Patch",
				],
				currentFiles: {
					"models.ts":
						"class UserModel extends EventEmitter {\n  id: string\n  name: string\n  \n  async save(): Promise<void> {\n    await validateUser(this)\n    await db.insert('users', this.toJSON())\n    this.emit('saved')\n  }\n  \n  async delete(): Promise<void> {\n    await db.delete('users', this.id)\n  }\n}",
				},
				expectedActions: {
					"models.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 6,
								delLines: ["    await db.insert('users', this.toJSON())"],
								insLines: ["    await db.upsert('users', this.id, this.toJSON())"],
							},
						],
					},
				},
			},

			// V4A Format: Multiple @@ markers with 3 lines context
			{
				name: "update with multiple @@ markers and 3 lines context (V4A format)",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: handlers.ts",
					"@@ class BaseHandler",
					"@@ async process()",
					"     const validated = this.validate(input)",
					"     const processed = this.transform(validated)",
					"     ",
					"-    return this.send(processed)",
					"+    return await this.sendWithRetry(processed)",
					"   }",
					"   ",
					"   private validate(input: any): ValidatedData {",
					"*** End Patch",
				],
				currentFiles: {
					"handlers.ts":
						"class BaseHandler {\n  async process(input: any) {\n    const validated = this.validate(input)\n    const processed = this.transform(validated)\n    \n    return this.send(processed)\n  }\n  \n  private validate(input: any): ValidatedData {\n    return schema.parse(input)\n  }\n}",
				},
				expectedActions: {
					"handlers.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 5,
								delLines: ["    return this.send(processed)"],
								insLines: ["    return await this.sendWithRetry(processed)"],
							},
						],
					},
				},
			},

			// V4A Format: Changes within 3 lines (non-duplicated context)
			{
				name: "multiple changes within 3 lines without duplicate context (V4A format)",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: config.ts",
					"@@",
					" export const config = {",
					"   database: {",
					"     host: 'localhost',",
					"-    port: 5432,",
					"+    port: parseInt(process.env.DB_PORT || '5432'),",
					"     username: 'admin',",
					"-    password: 'secret',",
					"+    password: process.env.DB_PASSWORD || 'secret',",
					"     database: 'myapp'",
					"   }",
					" }",
					"*** End Patch",
				],
				currentFiles: {
					"config.ts":
						"export const config = {\n  database: {\n    host: 'localhost',\n    port: 5432,\n    username: 'admin',\n    password: 'secret',\n    database: 'myapp'\n  }\n}",
				},
				expectedActions: {
					"config.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 3,
								delLines: ["    port: 5432,"],
								insLines: ["    port: parseInt(process.env.DB_PORT || '5432'),"],
							},
							{
								origIndex: 5,
								delLines: ["    password: 'secret',"],
								insLines: ["    password: process.env.DB_PASSWORD || 'secret',"],
							},
						],
					},
				},
			},

			// V4A Format: Large context block
			{
				name: "update with large context block (V4A format)",
				patchLines: [
					"*** Begin Patch",
					"*** Update File: router.ts",
					"@@",
					" export class Router {",
					"   private routes: Map<string, Handler> = new Map()",
					"   ",
					"-  register(path: string, handler: Handler) {",
					"-    this.routes.set(path, handler)",
					"+  register(path: string, handler: Handler, options?: RouteOptions) {",
					"+    const wrappedHandler = this.wrapHandler(handler, options)",
					"+    this.routes.set(path, wrappedHandler)",
					"   }",
					"   ",
					"   async handle(path: string, req: Request) {",
					"*** End Patch",
				],
				currentFiles: {
					"router.ts":
						"export class Router {\n  private routes: Map<string, Handler> = new Map()\n  \n  register(path: string, handler: Handler) {\n    this.routes.set(path, handler)\n  }\n  \n  async handle(path: string, req: Request) {\n    const handler = this.routes.get(path)\n    return handler?.(req)\n  }\n}",
				},
				expectedActions: {
					"router.ts": {
						type: PatchActionType.UPDATE,
						chunks: [
							{
								origIndex: 3,
								delLines: ["  register(path: string, handler: Handler) {", "    this.routes.set(path, handler)"],
								insLines: [
									"  register(path: string, handler: Handler, options?: RouteOptions) {",
									"    const wrappedHandler = this.wrapHandler(handler, options)",
									"    this.routes.set(path, wrappedHandler)",
								],
							},
						],
					},
				},
			},
		]

		// Run all test cases
		for (const testCase of testCases) {
			it(testCase.name, () => {
				const parser = new PatchParser(testCase.patchLines, testCase.currentFiles)

				if (testCase.expectedError) {
					// Expect an error to be thrown
					expect(() => parser.parse()).to.throw(DiffError, testCase.expectedError)
				} else {
					// Expect successful parsing
					const result = parser.parse()

					// Check that actions were parsed
					expect(result.patch.actions).to.exist

					// Validate expected actions if provided
					if (testCase.expectedActions) {
						const actionKeys = Object.keys(testCase.expectedActions)
						expect(Object.keys(result.patch.actions)).to.have.lengthOf(actionKeys.length)

						for (const [filePath, expectedAction] of Object.entries(testCase.expectedActions)) {
							const actualAction = result.patch.actions[filePath]
							expect(actualAction, `Action for ${filePath} should exist`).to.exist

							// Check action type
							expect(actualAction!.type).to.equal(expectedAction.type)

							// Check newFile for ADD operations
							if (expectedAction.newFile !== undefined) {
								expect(actualAction!.newFile).to.equal(expectedAction.newFile)
							}

							// Check movePath for MOVE operations
							if (expectedAction.movePath !== undefined) {
								expect(actualAction!.movePath).to.equal(expectedAction.movePath)
							}

							// Check chunks if provided
							if (expectedAction.chunks !== undefined) {
								expect(actualAction!.chunks).to.have.lengthOf(expectedAction.chunks.length)

								for (let i = 0; i < expectedAction.chunks.length; i++) {
									const expectedChunk = expectedAction.chunks[i]
									const actualChunk = actualAction!.chunks[i]

									if (expectedChunk.origIndex !== undefined) {
										expect(actualChunk!.origIndex).to.equal(expectedChunk.origIndex)
									}
									if (expectedChunk.delLines !== undefined) {
										expect(actualChunk!.delLines).to.deep.equal(expectedChunk.delLines)
									}
									if (expectedChunk.insLines !== undefined) {
										expect(actualChunk!.insLines).to.deep.equal(expectedChunk.insLines)
									}
								}
							}
						}
					}

					// Check fuzz if specified
					if (testCase.expectedFuzz !== undefined) {
						expect(result.fuzz).to.equal(testCase.expectedFuzz)
					}
				}
			})
		}
	})

	describe("Edge Cases", () => {
		it("should handle empty patch", () => {
			const parser = new PatchParser(["*** Begin Patch", "*** End Patch"], {})
			const result = parser.parse()
			expect(result.patch.actions).to.be.empty
		})

		it("should handle patch without Begin marker", () => {
			const parser = new PatchParser(["*** Add File: test.ts", "+content", "*** End Patch"], {})
			const result = parser.parse()
			expect(result.patch.actions).to.have.key("test.ts")
		})

		it("should handle large files with many chunks", () => {
			const lines = Array.from({ length: 1000 }, (_, i) => `line ${i}`)
			const fileContent = lines.join("\n")

			const patchLines = [
				"*** Begin Patch",
				"*** Update File: large.ts",
				"@@",
				" line 500",
				"-line 501",
				"+line 501 modified",
				" line 502",
				"*** End Patch",
			]

			const parser = new PatchParser(patchLines, { "large.ts": fileContent })
			const result = parser.parse()

			expect(result.patch.actions["large.ts"]).to.exist
			expect(result.patch.actions["large.ts"]!.chunks).to.have.lengthOf(1)
			expect(result.patch.actions["large.ts"]!.chunks[0]!.origIndex).to.equal(501)
		})

		it("should handle unicode characters in content", () => {
			const patchLines = [
				"*** Begin Patch",
				"*** Update File: unicode.ts",
				"@@",
				" const emoji = '😀'",
				"-const text = 'hello'",
				"+const text = '你好'",
				"*** End Patch",
			]

			const parser = new PatchParser(patchLines, {
				"unicode.ts": "const emoji = '😀'\nconst text = 'hello'",
			})
			const result = parser.parse()

			expect(result.patch.actions["unicode.ts"]).to.exist
			expect(result.patch.actions["unicode.ts"]!.chunks[0]!.insLines[0]).to.equal("const text = '你好'")
		})

		it("should handle empty lines in context", () => {
			const patchLines = ["*** Begin Patch", "*** Update File: test.ts", "@@", " ", "-old", "+new", " ", "*** End Patch"]

			const parser = new PatchParser(patchLines, {
				"test.ts": "\nold\n",
			})
			const result = parser.parse()

			expect(result.patch.actions["test.ts"]).to.exist
		})
	})

	describe("Fuzz Scoring", () => {
		it("should return fuzz=0 for exact matches", () => {
			const patchLines = [
				"*** Begin Patch",
				"*** Update File: test.ts",
				"@@",
				" exact match",
				"-old",
				"+new",
				"*** End Patch",
			]

			const parser = new PatchParser(patchLines, {
				"test.ts": "exact match\nold",
			})
			const result = parser.parse()

			expect(result.fuzz).to.equal(0)
		})

		it("should return fuzz=1 for trailing whitespace differences", () => {
			const patchLines = ["*** Begin Patch", "*** Update File: test.ts", "@@", " match  ", "-old", "+new", "*** End Patch"]

			const parser = new PatchParser(patchLines, {
				"test.ts": "match\nold",
			})
			const result = parser.parse()

			expect(result.fuzz).to.be.greaterThan(0)
		})

		it("should return high fuzz for whitespace-only differences", () => {
			const patchLines = [
				"*** Begin Patch",
				"*** Update File: test.ts",
				"@@",
				"   match   ",
				"-old",
				"+new",
				"*** End Patch",
			]

			const parser = new PatchParser(patchLines, {
				"test.ts": "match\nold",
			})
			const result = parser.parse()

			expect(result.fuzz).to.be.greaterThan(10)
		})
	})

	describe("Partial Matching and Warnings", () => {
		it("should skip invalid chunks and add warnings", () => {
			const patchLines = [
				"*** Begin Patch",
				"*** Update File: test.ts",
				"@@",
				" function valid() {",
				"-  old()",
				"+  new()",
				" }",
				"@@",
				" nonexistent context",
				"-  should skip this",
				"+  should skip this too",
				"*** End Patch",
			]

			const parser = new PatchParser(patchLines, {
				"test.ts": "function valid() {\n  old()\n}\nfunction other() {\n  code()\n}",
			})
			const result = parser.parse()

			// Should have one valid chunk applied
			expect(result.patch.actions["test.ts"]).to.exist
			expect(result.patch.actions["test.ts"]!.chunks).to.have.lengthOf(1)
			expect(result.patch.actions["test.ts"]!.chunks[0]!.origIndex).to.equal(1)

			// Should have warnings for skipped chunk
			expect(result.patch.warnings).to.exist
			expect(result.patch.warnings).to.have.lengthOf(1)
			expect(result.patch.warnings![0]!.path).to.equal("test.ts")
			expect(result.patch.warnings![0]!.message).to.match(/Could not find matching context/)
		})

		it("should handle mixed valid and invalid chunks", () => {
			const patchLines = [
				"*** Begin Patch",
				"*** Update File: test.ts",
				"@@",
				"chunk1",
				"-old1",
				"+new1",
				"@@",
				"nonexistent",
				"-skip",
				"+skip",
				"@@",
				"chunk3",
				"-old3",
				"+new3",
				"*** End Patch",
			]

			const parser = new PatchParser(patchLines, {
				"test.ts": "chunk1\nold1\nchunk3\nold3",
			})
			const result = parser.parse()

			// Should have 2 valid chunks (1st and 3rd)
			expect(result.patch.actions["test.ts"]!.chunks).to.have.lengthOf(2)

			// Should have 1 warning for skipped chunk
			expect(result.patch.warnings).to.have.lengthOf(1)
		})
	})
})
