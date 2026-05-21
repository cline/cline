import { describe, it } from "mocha"
import "should"
import { Anthropic } from "@anthropic-ai/sdk"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ClineDefaultTool } from "@/shared/tools"
import { transformToolCallMessages } from ".."

describe("transformToolCallMessages", () => {
	describe("apply_patch conversion", () => {
		const testCases: Array<{
			name: string
			input: ClineStorageMessage[]
			expected: {
				toolName: string
				inputPath?: string
				inputContent?: string
				inputDiff?: string
			}[]
		}> = [
			{
				name: "should convert apply_patch Add operation to write_to_file",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_123",
								name: "apply_patch",
								input: {
									input: `apply_patch <<"EOF"
*** Begin Patch
*** Add File: src/new-file.ts
@@
+export function newFunction() {
+	return "hello world"
+}
*** End Patch
EOF`,
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "write_to_file",
						inputPath: "src/new-file.ts",
						inputContent: `export function newFunction() {
	return "hello world"
}`,
					},
				],
			},
			{
				name: "should convert apply_patch Update operation to replace_in_file",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_456",
								name: "apply_patch",
								input: {
									input: 'apply_patch <<"EOF"\n*** Begin Patch\n*** Update File: src/existing-file.ts\n@@\nfunction oldFunction() {\n-\treturn "old"\n+\treturn "new"\n}\n*** End Patch\nEOF',
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "replace_in_file",
						inputPath: "src/existing-file.ts",
						inputDiff:
							'------- SEARCH\n\nfunction oldFunction() {\n\treturn "old"\n}\n=======\n\nfunction oldFunction() {\n\treturn "new"\n}\n+++++++ REPLACE',
					},
				],
			},
			{
				name: "should handle multiple tool_use blocks in same message",
				input: [
					{
						role: "assistant",
						content: [
							{ type: "text", text: "Making changes..." },
							{
								type: "tool_use",
								id: "toolu_001",
								name: "apply_patch",
								input: {
									input: `apply_patch <<"EOF"
*** Begin Patch
*** Add File: file1.ts
@@
+const x = 1
*** End Patch
EOF`,
								},
							},
							{
								type: "tool_use",
								id: "toolu_002",
								name: "apply_patch",
								input: {
									input: `apply_patch <<"EOF"
*** Begin Patch
*** Update File: file2.ts
@@1
2
3
4
- old line
+ new line
6
7
8
*** End Patch
EOF`,
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "write_to_file",
						inputPath: "file1.ts",
						inputContent: "const x = 1",
					},
					{
						toolName: "replace_in_file",
						inputPath: "file2.ts",
						inputDiff: `------- SEARCH
1
2
3
4
old line
6
7
8
=======
1
2
3
4
new line
6
7
8
+++++++ REPLACE`,
					},
				],
			},
			{
				name: "should preserve non-apply_patch tool calls",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_999",
								name: "read_file",
								input: { path: "some-file.ts" },
							},
						],
					},
				],
				expected: [
					{
						toolName: "read_file",
					},
				],
			},
			{
				name: "should handle apply_patch with @@ context markers",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_777",
								name: "apply_patch",
								input: {
									input: 'apply_patch <<"EOF"\n*** Begin Patch\n*** Update File: src/class.ts\n@@class MyClass\n@@\t\tmethod():\n-\t\t\treturn false\n+\t\t\treturn true\n*** End Patch\nEOF',
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "replace_in_file",
						inputPath: "src/class.ts",
						inputDiff:
							"------- SEARCH\nclass MyClass\n\t\tmethod():\n\t\t\treturn false\n=======\nclass MyClass\n\t\tmethod():\n\t\t\treturn true\n+++++++ REPLACE",
					},
				],
			},
			{
				name: "should handle Delete operation as replace_in_file",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_888",
								name: "apply_patch",
								input: {
									input: `apply_patch <<"EOF"
*** Begin Patch
*** Delete File: src/obsolete.ts
-function oldCode() {
-	console.log("delete me")
-}
*** End Patch
EOF`,
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "replace_in_file",
						inputPath: "src/obsolete.ts",
						inputDiff: `------- SEARCH
function oldCode() {
	console.log("delete me")
}
=======

+++++++ REPLACE`,
					},
				],
			},
			{
				name: "should handle malformed apply_patch by fallback to write_to_file",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_bad",
								name: "apply_patch",
								input: {
									input: "invalid patch format",
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "write_to_file",
					},
				],
			},
			{
				name: "should match tool_result blocks with converted tool_use",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_paired",
								name: "apply_patch",
								input: {
									input: `apply_patch <<"EOF"
*** Begin Patch
*** Add File: test.ts
@@
+ const test = 1
*** End Patch
EOF`,
								},
							},
						],
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "toolu_paired",
								content: "File created successfully",
							},
						],
					},
				],
				expected: [
					{
						toolName: "write_to_file",
						inputPath: "test.ts",
						inputContent: "const test = 1",
					},
				],
			},
			{
				name: "should handle multiple apply_patch operations in one message",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_paired",
								name: "apply_patch",
								input: {
									input: '%%bash\napply_patch <<"EOF"\n*** Begin Patch\n*** Update File: CONTRIBUTING.md\n@@\n-3. Install the necessary dependencies for the extension and webview-gui:\n-\t```bash\n-\tnpm run install:all\n-\t```\n-4. Generate Protocol Buffer files (required before first build):\n-\t```bash\n-\tnpm run protos\n-\t```\n+3. Install the necessary dependencies for the extension and webview-gui:\n+\t```bash\n+\tbun run install:all\n+\t```\n+4. Generate Protocol Buffer files (required before first build):\n+\t```bash\n+\tbun run protos\n+\t```\n@@\n-1. Before creating a PR, generate a changeset entry:\n-\t```bash\n-\tnpm run changeset\n-\t```\n+1. Before creating a PR, generate a changeset entry:\n+\t```bash\n+\tbun run changeset\n+\t```\n@@\n-4. Testing\n-\n-\t- Run `npm run test` to run tests locally. \n-\t- Before submitting PR, run `npm run format:fix` to format your code\n+4. Testing\n+\n+\t- Run `bun run test` to run tests locally. \n+\t- Before submitting PR, run `bun run format:fix` to format your code\n@@\n-2. **Local Development**\n-\t- Run `npm run install:all` to install dependencies\n-\t- Run `npm run protos` to generate Protocol Buffer files (required before first build)\n-\t- Run `npm run test` to run tests locally\n+2. **Local Development**\n+\t- Run `bun run install:all` to install dependencies\n+\t- Run `bun run protos` to generate Protocol Buffer files (required before first build)\n+\t- Run `bun run test` to run tests locally\n*** End Patch\nEOF',
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "replace_in_file",
						inputPath: "CONTRIBUTING.md",

						inputDiff:
							"------- SEARCH\n\n3. Install the necessary dependencies for the extension and webview-gui:\n\t```bash\n\tnpm run install:all\n\t```\n4. Generate Protocol Buffer files (required before first build):\n\t```bash\n\tnpm run protos\n\t```\n=======\n\n3. Install the necessary dependencies for the extension and webview-gui:\n\t```bash\n\tbun run install:all\n\t```\n4. Generate Protocol Buffer files (required before first build):\n\t```bash\n\tbun run protos\n\t```\n+++++++ REPLACE\n------- SEARCH\n\n1. Before creating a PR, generate a changeset entry:\n\t```bash\n\tnpm run changeset\n\t```\n=======\n\n1. Before creating a PR, generate a changeset entry:\n\t```bash\n\tbun run changeset\n\t```\n+++++++ REPLACE\n------- SEARCH\n\n4. Testing\n\n\t- Run `npm run test` to run tests locally. \n\t- Before submitting PR, run `npm run format:fix` to format your code\n=======\n\n4. Testing\n\n\t- Run `bun run test` to run tests locally. \n\t- Before submitting PR, run `bun run format:fix` to format your code\n+++++++ REPLACE\n------- SEARCH\n\n2. **Local Development**\n\t- Run `npm run install:all` to install dependencies\n\t- Run `npm run protos` to generate Protocol Buffer files (required before first build)\n\t- Run `npm run test` to run tests locally\n=======\n\n2. **Local Development**\n\t- Run `bun run install:all` to install dependencies\n\t- Run `bun run protos` to generate Protocol Buffer files (required before first build)\n\t- Run `bun run test` to run tests locally\n+++++++ REPLACE",
					},
				],
			},
			{
				name: "should handle context after @@ markers as first line of search block",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_paired",
								name: "apply_patch",
								input: {
									input: `%%bash
apply_patch <<"EOF"
*** Begin Patch
*** Update File: pygorithm/searching/simple.md
@@[4 line above change]
[3 line above change]
[2 line above change]
[1 line above change]
-[exact content to find]
+[new content to replace with]
[1 line below change]
[2 line below change]
[3 line below change]
*** End Patch
EOF`,
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "replace_in_file",
						inputPath: "pygorithm/searching/simple.md",

						inputDiff: `------- SEARCH
[4 line above change]
[3 line above change]
[2 line above change]
[1 line above change]
[exact content to find]
[1 line below change]
[2 line below change]
[3 line below change]
=======
[4 line above change]
[3 line above change]
[2 line above change]
[1 line above change]
[new content to replace with]
[1 line below change]
[2 line below change]
[3 line below change]
+++++++ REPLACE`,
					},
				],
			},
		]

		testCases.forEach((testCase) => {
			it(testCase.name, () => {
				// When native tools are FILE_EDIT/FILE_NEW and messages use apply_patch, convert FROM apply_patch
				const result = transformToolCallMessages(testCase.input, [ClineDefaultTool.FILE_EDIT, ClineDefaultTool.FILE_NEW])
				// Find all tool_use blocks in the result
				const toolUseBlocks: Anthropic.ContentBlock[] = []
				for (const message of result) {
					if (Array.isArray(message.content)) {
						for (const block of message.content) {
							if (block.type === "tool_use") {
								toolUseBlocks.push(block)
							}
						}
					}
				}

				// Verify we have the expected number of tool uses
				toolUseBlocks.should.have.length(testCase.expected.length)

				// Check each tool use against expectations
				testCase.expected.forEach((expected, index) => {
					const toolBlock = toolUseBlocks[index]
					toolBlock.should.have.property("type", "tool_use")

					if (toolBlock.type === "tool_use") {
						toolBlock.should.have.property("name", expected.toolName)

						const input = toolBlock.input as any

						if (expected.inputPath) {
							input.should.have.property("absolutePath", expected.inputPath)
						}

						if (expected.inputContent !== undefined) {
							input.should.have.property("content", expected.inputContent)
						}

						if (expected.inputDiff !== undefined) {
							if (typeof expected.inputDiff === "string") {
								input.should.have.property("diff", expected.inputDiff)
							} else if (expected.inputDiff === true) {
								input.should.have.property("diff")
								input.diff.should.be.a.String()
								input.diff.should.not.be.empty()
							}
						}
					}
				})
			})
		})

		it("should preserve tool_result blocks when tool_use is converted", () => {
			const input: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_result_test",
							name: "apply_patch",
							input: {
								input: `apply_patch <<"EOF"
*** Begin Patch
*** Add File: result-test.ts
+ export const x = 1
*** End Patch
EOF`,
							},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_result_test",
							content: "Success",
						},
					],
				},
			]

			// Native tools are FILE_EDIT/FILE_NEW, messages use apply_patch → convert FROM apply_patch
			// Native tools are FILE_EDIT/FILE_NEW, messages use apply_patch → convert FROM apply_patch
			const result = transformToolCallMessages(input, [ClineDefaultTool.FILE_EDIT, ClineDefaultTool.FILE_NEW])

			// Find the tool_result block
			let foundToolResult = false
			for (const message of result) {
				if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "tool_result" && block.tool_use_id === "toolu_result_test") {
							foundToolResult = true
							block.should.have.property("content", "Success")
						}
					}
				}
			}

			foundToolResult.should.be.true()
		})

		it("should reconstruct tool_result content with final_file_content for write_to_file", () => {
			const input: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_write",
							name: "apply_patch",
							input: {
								input: `apply_patch <<"EOF"
*** Begin Patch
*** Add File: new-file.ts
+ export const newVar = 42
*** End Patch
EOF`,
							},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_write",
							content:
								"[write_to_file for 'new-file.ts'] Result:\nThe content was successfully saved to new-file.ts.\n\n<final_file_content path=\"new-file.ts\">\nexport const newVar = 42\n</final_file_content>\n\nIMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference.",
						},
					],
				},
			]

			// Native tools are FILE_EDIT/FILE_NEW, messages use apply_patch → convert FROM apply_patch
			const result = transformToolCallMessages(input, [ClineDefaultTool.FILE_EDIT, ClineDefaultTool.FILE_NEW])

			// Find and verify the reconstructed tool_result
			let reconstructedContent = ""
			for (const message of result) {
				if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "tool_result" && block.tool_use_id === "toolu_write") {
							reconstructedContent = typeof block.content === "string" ? block.content : ""
						}
					}
				}
			}

			reconstructedContent.should.match(/\[apply_patch for 'new-file\.ts'\]/)
			reconstructedContent.should.match(/successfully saved/)
		})

		it("should reconstruct tool_result content with final_file_content for replace_in_file", () => {
			const input: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_replace",
							name: "apply_patch",
							input: {
								input: `apply_patch <<"EOF"
*** Begin Patch
*** Update File: existing.ts
- const old = 1
+ const new = 2
*** End Patch
EOF`,
							},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_replace",
							content:
								"[replace_in_file for 'existing.ts'] Result:\nThe content was successfully saved to existing.ts.\n\n<final_file_content path=\"existing.ts\">\nconst new = 2\n</final_file_content>\n\nIMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference.",
						},
					],
				},
			]

			// Native tools are FILE_EDIT/FILE_NEW, messages use apply_patch → convert FROM apply_patch
			const result = transformToolCallMessages(input, [ClineDefaultTool.FILE_EDIT, ClineDefaultTool.FILE_NEW])

			// Find and verify the reconstructed tool_result
			let reconstructedContent = ""
			for (const message of result) {
				if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "tool_result" && block.tool_use_id === "toolu_replace") {
							reconstructedContent = typeof block.content === "string" ? block.content : ""
						}
					}
				}
			}

			reconstructedContent.should.match(/\[apply_patch for 'existing\.ts'\]/)
			reconstructedContent.should.match(/successfully updated/)
			reconstructedContent.should.match(/<final_file_content/)
			reconstructedContent.should.match(/IMPORTANT: For any future changes/)
		})

		it("should handle tool_result without final_file_content gracefully", () => {
			const input: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_no_content",
							name: "apply_patch",
							input: {
								input: `apply_patch <<"EOF"
*** Begin Patch
*** Add File: test.ts
+ const x = 1
*** End Patch
EOF`,
							},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_no_content",
							content: "Simple success message without final_file_content",
						},
					],
				},
			]

			// Native tools are FILE_EDIT/FILE_NEW, messages use apply_patch → convert FROM apply_patch
			const result = transformToolCallMessages(input, [ClineDefaultTool.FILE_EDIT, ClineDefaultTool.FILE_NEW])

			// Find the tool_result and verify it kept original content
			let foundContent = ""
			for (const message of result) {
				if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "tool_result" && block.tool_use_id === "toolu_no_content") {
							foundContent = typeof block.content === "string" ? block.content : ""
						}
					}
				}
			}

			foundContent.should.equal("Simple success message without final_file_content")
		})

		it("should generate valid SEARCH/REPLACE diff format", () => {
			const input: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_diff",
							name: "apply_patch",
							input: {
								input: `apply_patch <<"EOF"
*** Begin Patch
*** Update File: src/test.ts
@@
context line 1
context line 2
- old line
+ new line
context line 3
*** End Patch
EOF`,
							},
						},
					],
				},
			]

			// Native tools are FILE_EDIT/FILE_NEW, messages use apply_patch → convert FROM apply_patch
			const result = transformToolCallMessages(input, [ClineDefaultTool.FILE_EDIT, ClineDefaultTool.FILE_NEW])

			// Extract the diff from the converted tool
			let diffContent = ""
			for (const message of result) {
				if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "tool_use" && block.name === "replace_in_file") {
							const input = block.input as any
							diffContent = input.diff
						}
					}
				}
			}

			// Verify the diff contains the SEARCH/REPLACE markers
			diffContent.should.match(/------- SEARCH/)
			diffContent.should.match(/=======/)
			diffContent.should.match(/\+\+\+\+\+\+\+ REPLACE/)
			diffContent.should.match(/old line/)
			diffContent.should.match(/new line/)
		})
	})

	describe("write_to_file/replace_in_file to apply_patch conversion", () => {
		const testCases: Array<{
			name: string
			input: ClineStorageMessage[]
			expected: {
				toolName: string
				patchInput?: string
			}[]
		}> = [
			{
				name: "should convert write_to_file to apply_patch Add operation",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_write",
								name: "write_to_file",
								input: {
									absolutePath: "src/new-file.ts",
									content: "export const x = 1\nexport const y = 2",
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "apply_patch",
						patchInput: `apply_patch <<"EOF"
*** Begin Patch
*** Add File: src/new-file.ts
@@
+ export const x = 1
+ export const y = 2
*** End Patch
EOF`,
					},
				],
			},
			{
				name: "should convert replace_in_file to apply_patch Update operation",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_replace",
								name: "replace_in_file",
								input: {
									absolutePath: "src/existing.ts",
									diff: `------- SEARCH
const old = 1
=======
const new = 2
+++++++ REPLACE`,
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "apply_patch",
						patchInput: `apply_patch <<"EOF"
*** Begin Patch
*** Update File: src/existing.ts
@@
- const old = 1
+ const new = 2
*** End Patch
EOF`,
					},
				],
			},
			{
				name: "should handle multiple write_to_file and replace_in_file in same message",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_1",
								name: "write_to_file",
								input: {
									absolutePath: "file1.ts",
									content: "const a = 1",
								},
							},
							{
								type: "tool_use",
								id: "toolu_2",
								name: "replace_in_file",
								input: {
									absolutePath: "file2.ts",
									diff: `------- SEARCH
old
=======
new
+++++++ REPLACE`,
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "apply_patch",
						patchInput: `apply_patch <<"EOF"
*** Begin Patch
*** Add File: file1.ts
@@
+ const a = 1
*** End Patch
EOF`,
					},
					{
						toolName: "apply_patch",
						patchInput: `apply_patch <<"EOF"
*** Begin Patch
*** Update File: file2.ts
@@
- old
+ new
*** End Patch
EOF`,
					},
				],
			},
			{
				name: "should preserve non-write_to_file/replace_in_file tool calls",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_other",
								name: "read_file",
								input: { path: "some-file.ts" },
							},
						],
					},
				],
				expected: [
					{
						toolName: "read_file",
					},
				],
			},
			{
				name: "should convert replace_in_file with context lines to apply_patch",
				input: [
					{
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: "toolu_context",
								name: "replace_in_file",
								input: {
									absolutePath: "src/test.ts",
									diff: `------- SEARCH
function oldFunction() {
	return "old"
}
=======
function oldFunction() {
	return "new"
}
+++++++ REPLACE`,
								},
							},
						],
					},
				],
				expected: [
					{
						toolName: "apply_patch",
						patchInput: `apply_patch <<"EOF"
*** Begin Patch
*** Update File: src/test.ts
@@
function oldFunction() {
- 	return "old"
+ 	return "new"
}
*** End Patch
EOF`,
					},
				],
			},
		]

		testCases.forEach((testCase) => {
			it(testCase.name, () => {
				// Native tools are APPLY_PATCH, messages use write_to_file/replace_in_file → convert TO apply_patch
				const result = transformToolCallMessages(testCase.input, [ClineDefaultTool.APPLY_PATCH])

				// Find all tool_use blocks in the result
				const toolUseBlocks: Anthropic.ContentBlock[] = []
				for (const message of result) {
					if (Array.isArray(message.content)) {
						for (const block of message.content) {
							if (block.type === "tool_use") {
								toolUseBlocks.push(block)
							}
						}
					}
				}

				// Verify we have the expected number of tool uses
				toolUseBlocks.should.have.length(testCase.expected.length)

				// Check each tool use against expectations
				testCase.expected.forEach((expected, index) => {
					const toolBlock = toolUseBlocks[index]
					toolBlock.should.have.property("type", "tool_use")

					if (toolBlock.type === "tool_use") {
						toolBlock.should.have.property("name", expected.toolName)

						if (expected.patchInput !== undefined) {
							const input = toolBlock.input as any
							const patchInput = input?.input || ""
							patchInput.should.equal(expected.patchInput)
						}
					}
				})
			})
		})

		it("should use final_file_content to generate apply_patch for write_to_file", () => {
			const input: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_write_result",
							name: "write_to_file",
							input: {
								absolutePath: "new.ts",
								content: "const x = 1\nconst y = 2",
							},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_write_result",
							content:
								"[write_to_file for 'new.ts'] Result:\nThe content was successfully saved to new.ts.\n\n<final_file_content path=\"new.ts\">\nconst x = 1\nconst y = 2\n</final_file_content>\n\nIMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference.",
						},
					],
				},
			]

			// Native tools are APPLY_PATCH, messages use write_to_file/replace_in_file → convert TO apply_patch
			const result = transformToolCallMessages(input, [ClineDefaultTool.APPLY_PATCH])

			// Find the tool_use block to verify the generated patch
			let toolUseBlock: any = null
			for (const message of result) {
				if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "tool_use" && block.name === "apply_patch") {
							toolUseBlock = block
							break
						}
					}
				}
			}

			toolUseBlock.should.not.be.null()
			toolUseBlock.name.should.equal("apply_patch")
			const patchInput = toolUseBlock.input.input
			patchInput.should.equal(`apply_patch <<"EOF"
*** Begin Patch
*** Add File: new.ts
@@
+ const x = 1
+ const y = 2
*** End Patch
EOF`)
		})

		it("should use final_file_content to generate apply_patch with context for replace_in_file", () => {
			const input: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_replace_result",
							name: "replace_in_file",
							input: {
								absolutePath: "foobar.ts",
								diff: `------- SEARCH
export function bar(foo: string): string {
=======
export function bar(foo: string): Foo {
+++++++ REPLACE`,
							},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_replace_result",
							content: `[replace_in_file for 'foobar.ts'] Result:\nThe content was successfully saved to foobar.ts.\n\n<final_file_content path="foobar.ts">\nimport * from "foo"\nexport type Foo = "bar"\nexport function bar(foo: string): Foo {\n\treturn foo as Foo\n}\n</final_file_content>\n\nIMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference.`,
						},
					],
				},
			]

			// Native tools are APPLY_PATCH, messages use write_to_file/replace_in_file → convert TO apply_patch
			const result = transformToolCallMessages(input, [ClineDefaultTool.APPLY_PATCH])

			// Find the tool_use block to verify the generated patch
			let toolUseBlock: any = null
			for (const message of result) {
				if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "tool_use" && block.name === "apply_patch") {
							toolUseBlock = block
							break
						}
					}
				}
			}

			toolUseBlock.should.not.be.null()
			toolUseBlock.name.should.equal("apply_patch")
			const patchInput = toolUseBlock.input.input

			// Verify the exact patch format
			const expectedPatch = `apply_patch <<"EOF"\n*** Begin Patch\n*** Update File: foobar.ts\n@@\nimport * from "foo"\nexport type Foo = "bar"\n- export function bar(foo: string): string {\n+ export function bar(foo: string): Foo {\n\treturn foo as Foo\n}\n*** End Patch\nEOF`
			patchInput.should.equal(expectedPatch)
		})

		it("should handle tool_result without final_file_content gracefully", () => {
			const input: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_no_final",
							name: "write_to_file",
							input: {
								absolutePath: "test.ts",
								content: "test",
							},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_no_final",
							content: "Success without final_file_content",
						},
					],
				},
			]

			// Native tools are APPLY_PATCH, messages use write_to_file/replace_in_file → convert TO apply_patch
			const result = transformToolCallMessages(input, [ClineDefaultTool.APPLY_PATCH])

			// Find the tool_result
			let foundContent = ""
			for (const message of result) {
				if (Array.isArray(message.content)) {
					for (const block of message.content) {
						if (block.type === "tool_result" && block.tool_use_id === "toolu_no_final") {
							foundContent = typeof block.content === "string" ? block.content : ""
						}
					}
				}
			}

			foundContent.should.match(/\[apply_patch for 'test\.ts'\]/)
			foundContent.should.match(/successfully/)
		})
	})
})
