import { execSync } from "child_process"
import * as path from "path"
import * as fs from "fs"
import { executeThroughCline, getWorkspaceDirectory, loadChatHistory } from "./cline-execution"
import { EnforcementRequest, EnforcementResponse, RequirementTestsResponse, RequirementTest } from "./types"
import { getExecuteTestPrompt } from "./prompts/generate-test"
import { getTestSubstepRequirementsPrompt } from "./prompts/test-substep-requirements"

const TEST_SUBSTEP_SYSTEM_PROMPT = "You are a code execution assistant. Use tools to make observations to fix the gaps identified. You will ultimately be writing unit tests."
const TEST_REQUIREMENTS_SYSTEM_PROMPT = "You are a test generation assistant. Write comprehensive tests for specific requirements."

export async function generateAndRunTests(request: EnforcementRequest, verification: EnforcementResponse): Promise<any> {
    try {
        console.log("[test-engine] 🧪 TEST Flow: generateAndRunTests")


        // Step 1: Build test file path
        const workspaceDir = getWorkspaceDirectory()
        const chatId = request.chat_id
        const nodeId = request.step_id || "unknown"
        const substepId = request.substep_id || "step"
        const testFileName = `${nodeId}-${substepId}_test.py`
        const testFilePath = path.join(".zoro", "generated", "assistant", chatId, "test", testFileName)
        const absoluteTestPath = path.join(workspaceDir, testFilePath)

        console.log("[test-engine] Test file:", testFilePath)

        // Step 2: Build test generation prompt
        const stepDescription = request.node?.description || ""
        const substepDescription = request.substep_id
            ? request.node?.substeps?.find((s) => s.id === request.substep_id)?.text
            : undefined

        const testPrompt = getExecuteTestPrompt(
            verification,
            stepDescription,
            substepDescription,
            workspaceDir,
            testFilePath,
            chatId,
            nodeId,
            substepId,
        )

        // Step 3: PHASE 1 - Three-stage test generation (like verification's two phases)
        console.log("[test-engine] 4-phase test generation")

        console.log("[test-engine] PHASE 1: Research implementation (3 iterations)")
        let messages = await executeThroughCline(testPrompt, TEST_SUBSTEP_SYSTEM_PROMPT, 3)

        console.log("[test-engine] PHASE 2: Write test file (3 iterations)")
        messages.push({
            role: "user",
            content: [
                {
                    type: "text",
                    text: `Now you MUST write the test file to: ${testFilePath}

Use the write_to_file tool. This is CRITICAL - the file must be created at this exact path.`,
                },
            ],
        })
        messages = await executeThroughCline("", TEST_SUBSTEP_SYSTEM_PROMPT, 3, messages)

        console.log("[test-engine] PHASE 3: Run test (1 iteration)")
        messages.push({
            role: "user",
            content: [{ type: "text", text: `Now run the test file: python ${testFilePath}` }],
        })
        messages = await executeThroughCline("", TEST_SUBSTEP_SYSTEM_PROMPT, 1, messages)

        if (!fs.existsSync(absoluteTestPath)) {
            console.log("[test-engine] ⚠️ Test file not created, creating minimal fallback test")
            fs.mkdirSync(path.dirname(absoluteTestPath), { recursive: true })
            const minimalTest = `import sys
import json
import unittest

sys.path.insert(0, '${workspaceDir}')

def print_test_result(name, status, description):
    result = {"name": name, "status": status, "description": description, "category": "general"}
    print(f"TEST_RESULT: {json.dumps(result)}")

class FallbackTest(unittest.TestCase):
    def test_generation_failed(self):
        print_test_result("test_generation_failed", "fail", "LLM did not generate test file")
        self.fail("Test file was not created by LLM")

if __name__ == '__main__':
    unittest.main()
`
            fs.writeFileSync(absoluteTestPath, minimalTest)
        }

        // Step 5: PHASE 2 - Extract test results
        console.log("[test-engine] PHASE 4: Extract test results")
        const testResults = await extractTestResults(absoluteTestPath)

        console.log("[test-engine] ✅ TEST Flow complete")
        return {
            test_file: testFilePath,
            results: testResults,
        }
    } catch (error) {
        console.error("[test-engine] Test generation error:", error)
        return {
            test_file: "",
            results: [],
            error: error instanceof Error ? error.message : "Unknown error",
        }
    }
}

async function extractTestResults(testFilePath: string): Promise<any[]> {
    console.log("[test-engine] Extracting test results from:", testFilePath)

    // Check if test file exists
    if (!fs.existsSync(testFilePath)) {
        console.log("[test-engine] Test file not found")
        return []
    }

    try {
        const workspaceDir = getWorkspaceDirectory()

        console.log("[test-engine] Executing test file:", testFilePath)
        console.log("[test-engine] Working directory:", workspaceDir)

        // Execute test from workspace directory (so imports work!)
        const output = execSync(`python "${testFilePath}"`, {
            cwd: workspaceDir,
            env: {
                ...process.env,
                PYTHONPATH: workspaceDir, // Ensure workspace directory is first in Python's import path
            },
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            timeout: 120000, // 120s timeout
        })

        console.log("[test-engine] Test execution completed")

        // Parse TEST_RESULT: lines from stdout
        const results: any[] = []
        const lines = output.split("\n")

        for (const line of lines) {
            if (line.includes("TEST_RESULT:")) {
                try {
                    const jsonStr = line.split("TEST_RESULT:")[1].trim()
                    const result = JSON.parse(jsonStr)
                    results.push(result)
                } catch (_parseError) {
                    console.warn("[test-engine] Failed to parse TEST_RESULT line:", line)
                }
            }
        }

        console.log(`[test-engine] Extracted ${results.length} test results from stdout`)
        return results
    } catch (error: any) {
        console.error("[test-engine] Test execution failed:", error)

        // Try to extract partial results from error output
        const output = error.stdout || error.output?.[1] || ""
        if (output) {
            const results: any[] = []
            const lines = output.split("\n")

            for (const line of lines) {
                if (line.includes("TEST_RESULT:")) {
                    try {
                        const jsonStr = line.split("TEST_RESULT:")[1].trim()
                        const result = JSON.parse(jsonStr)
                        results.push(result)
                    } catch (_parseError) {
                        // Skip unparseable lines
                    }
                }
            }

            if (results.length > 0) {
                console.log(`[test-engine] Extracted ${results.length} partial test results from failed execution`)
                return results
            }
        }

        // Return empty on complete failure
        return []
    }
}

const executionCache = new Map<string, { timestamp: number; result: any }>()
const CACHE_TTL = 60000

export function cacheExecution(requestId: string, result: any): void {
    executionCache.set(requestId, {
        timestamp: Date.now(),
        result,
    })
}

export function getCachedExecution(requestId: string): any | null {
    const cached = executionCache.get(requestId)
    if (!cached) {
        return null
    }

    if (Date.now() - cached.timestamp > CACHE_TTL) {
        executionCache.delete(requestId)
        return null
    }

    return cached.result
}

export function generateRequestId(request: any): string {
    const key = JSON.stringify({
        task: request.task,
        context: request.context,
        timestamp: Math.floor(Date.now() / 10000),
    })
    return Buffer.from(key).toString("base64").substring(0, 32)
}

export async function testSubstepRequirements(
    chatId: string,
    nodeId: string,
    targetId: string,
    stepDescription: string,
    substepDescription: string,
    requirements: Array<{ id: string; description: string; category: string }>,
): Promise<RequirementTestsResponse> {
    console.log("[test-engine] 🧪 Testing", requirements.length, "requirements")

    try {
        // 1. Validate inputs
        if (requirements.length === 0) {
            return {
                success: false,
                error: "No requirements provided",
                tests: [],
            }
        }

        // 2. Build test file path
        const workspaceDir = getWorkspaceDirectory()
        const testFileName = `${nodeId}-${targetId}_test.py`
        const testFilePath = path.join(".zoro", "generated", "assistant", chatId, "test", testFileName)
        const absoluteTestPath = path.join(workspaceDir, testFilePath)

        console.log("[test-engine] Test file:", testFilePath)

        // 3. Read existing test file if exists
        const existingTestFile = fs.existsSync(absoluteTestPath)
            ? fs.readFileSync(absoluteTestPath, "utf-8")
            : undefined

        console.log(
            "[test-engine]",
            existingTestFile ? `Updating ${requirements.length} tests` : `Creating ${requirements.length} new tests`,
        )

        // 4. Load chat history
        const chatHistory = await loadChatHistory(chatId)

        // 5. Build prompt
        const prompt = getTestSubstepRequirementsPrompt(
            stepDescription,
            substepDescription,
            requirements,
            workspaceDir,
            testFilePath,
            chatHistory,
            existingTestFile,
        )

        // 6. PHASE 1: Investigation (3 iterations)
        console.log("[test-engine] PHASE 1: Investigating implementation")
        let messages = await executeThroughCline(prompt, TEST_REQUIREMENTS_SYSTEM_PROMPT, 3)

        // 7. PHASE 2: Write/update test file (3 iterations)
        console.log("[test-engine] PHASE 2: Writing test file")
        messages.push({
            role: "user",
            content: [
                {
                    type: "text",
                    text: `Now write the complete test file to: ${testFilePath}

${existingTestFile ? "Update the existing test methods for the specified requirements and preserve all other code." : "Create a complete test file with all requirements."}

Use the write_to_file tool. This is CRITICAL.`,
                },
            ],
        })
        messages = await executeThroughCline("", TEST_REQUIREMENTS_SYSTEM_PROMPT, 3, messages)

        // 8. Validate syntax
        if (!fs.existsSync(absoluteTestPath)) {
            console.log("[test-engine] ⚠️ Test file was not created")
            return {
                success: false,
                error: "Test file was not created",
                tests: [],
            }
        }

        console.log("[test-engine] PHASE 3: Validating syntax")
        try {
            execSync(`python -m py_compile "${absoluteTestPath}"`, {
                cwd: workspaceDir,
                encoding: "utf-8",
            })
            console.log("[test-engine] ✓ Syntax valid")
        } catch (syntaxError: any) {
            console.error("[test-engine] Syntax error:", syntaxError.message)
            return {
                success: false,
                error: `Syntax error in generated test: ${syntaxError.message}`,
                tests: [],
                test_file: testFilePath,
            }
        }

        // 9. Run selective tests
        console.log("[test-engine] PHASE 4: Running selective tests")
        const testResults = await runSelectiveTests(absoluteTestPath, workspaceDir, requirements)

        console.log(`[test-engine] ✅ Completed ${testResults.length} tests`)

        return {
            success: true,
            tests: testResults,
            test_file: testFilePath,
        }
    } catch (error) {
        console.error("[test-engine] Test requirements error:", error)
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
            tests: [],
        }
    }
}

async function runSelectiveTests(
    testFilePath: string,
    workspaceDir: string,
    requirements: Array<{ id: string; description: string; category: string }>,
): Promise<RequirementTest[]> {
    console.log("[test-engine] Running tests for requirements:", requirements.map((r) => r.id).join(", "))

    try {
        // Build pytest filter pattern with exact matching
        const pattern = requirements.map((r) => `test_${r.id.replace(/-/g, "_")}_`).join(" or ")

        console.log("[test-engine] Test filter pattern:", pattern)

        // Run pytest with filter
        const output = execSync(`python "${testFilePath}"`, {
            cwd: workspaceDir,
            env: {
                ...process.env,
                PYTHONPATH: workspaceDir,
            },
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120000,
        })

        // Parse results
        return parseRequirementTestResults(output, requirements)
    } catch (error: any) {
        console.error("[test-engine] Test execution failed:", error)

        // Try to extract partial results
        const output = error.stdout || error.output?.[1] || ""
        if (output) {
            const partialResults = parseRequirementTestResults(output, requirements)
            if (partialResults.length > 0) {
                console.log("[test-engine] Extracted partial results:", partialResults.length)
                return partialResults
            }
        }

        // Return empty results on complete failure
        return []
    }
}

function parseRequirementTestResults(
    output: string,
    requirements: Array<{ id: string; description: string; category: string }>,
): RequirementTest[] {
    const results: RequirementTest[] = []
    const lines = output.split("\n")

    for (const line of lines) {
        if (line.includes("TEST_RESULT:")) {
            try {
                const jsonStr = line.split("TEST_RESULT:")[1].trim()
                const parsed = JSON.parse(jsonStr)

                // Only include results that match our requirement IDs
                if (parsed.requirement_id && requirements.some((r) => r.id === parsed.requirement_id)) {
                    results.push({
                        requirement_id: parsed.requirement_id,
                        test_name: parsed.name || "unknown",
                        test_description: parsed.description || "",
                        test_code: parsed.test_code || "",
                        status: parsed.status || "error",
                        output: parsed.output || parsed.description || "",
                    })
                }
            } catch (parseError) {
                console.warn("[test-engine] Failed to parse TEST_RESULT line:", line)
            }
        }
    }

    console.log(`[test-engine] Parsed ${results.length} requirement test results`)
    return results
}
