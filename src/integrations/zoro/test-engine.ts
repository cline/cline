import { execSync } from "child_process"
import * as path from "path"
import * as fs from "fs"
import { executeThroughCline, getWorkspaceDirectory } from "./cline-execution"
import { EnforcementRequest, EnforcementResponse } from "./types"
import { getExecuteTestPrompt } from "./prompts/generate-test"

const TEST_SUBSTEP_SYSTEM_PROMPT = "You are a code execution assistant. Use tools to make observations to fix the gaps identified. You will ultimately be writing unit tests."

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
