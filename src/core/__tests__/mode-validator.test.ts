import { isToolAllowedForMode, validateToolUse } from '../mode-validator'
import { codeMode, architectMode, askMode } from '../prompts/system'
import { CODE_ALLOWED_TOOLS, READONLY_ALLOWED_TOOLS, ToolName } from '../tool-lists'

// For testing purposes, we need to handle the 'unknown_tool' case
type TestToolName = ToolName | 'unknown_tool';

// Helper function to safely cast string to TestToolName for testing
function asTestTool(str: string): TestToolName {
    return str as TestToolName;
}

describe('mode-validator', () => {
    describe('isToolAllowedForMode', () => {
        describe('code mode', () => {
            it('allows all code mode tools', () => {
                CODE_ALLOWED_TOOLS.forEach(tool => {
                    expect(isToolAllowedForMode(tool, codeMode)).toBe(true)
                })
            })

            it('disallows unknown tools', () => {
                expect(isToolAllowedForMode(asTestTool('unknown_tool'), codeMode)).toBe(false)
            })
        })

        describe('architect mode', () => {
            it('allows only read-only and MCP tools', () => {
                // Test allowed tools
                READONLY_ALLOWED_TOOLS.forEach(tool => {
                    expect(isToolAllowedForMode(tool, architectMode)).toBe(true)
                })

                // Test specific disallowed tools that we know are in CODE_ALLOWED_TOOLS but not in READONLY_ALLOWED_TOOLS
                const disallowedTools = ['execute_command', 'write_to_file', 'apply_diff'] as const;
                disallowedTools.forEach(tool => {
                    expect(isToolAllowedForMode(tool as ToolName, architectMode)).toBe(false)
                })
            })
        })

        describe('ask mode', () => {
            it('allows only read-only and MCP tools', () => {
                // Test allowed tools
                READONLY_ALLOWED_TOOLS.forEach(tool => {
                    expect(isToolAllowedForMode(tool, askMode)).toBe(true)
                })

                // Test specific disallowed tools that we know are in CODE_ALLOWED_TOOLS but not in READONLY_ALLOWED_TOOLS
                const disallowedTools = ['execute_command', 'write_to_file', 'apply_diff'] as const;
                disallowedTools.forEach(tool => {
                    expect(isToolAllowedForMode(tool as ToolName, askMode)).toBe(false)
                })
            })
        })
    })

    describe('validateToolUse', () => {
        it('throws error for disallowed tools in architect mode', () => {
            expect(() => validateToolUse('write_to_file' as ToolName, architectMode)).toThrow(
                'Tool "write_to_file" is not allowed in architect mode.'
            )
        })

        it('throws error for disallowed tools in ask mode', () => {
            expect(() => validateToolUse('execute_command' as ToolName, askMode)).toThrow(
                'Tool "execute_command" is not allowed in ask mode.'
            )
        })

        it('throws error for unknown tools in code mode', () => {
            expect(() => validateToolUse(asTestTool('unknown_tool'), codeMode)).toThrow(
                'Tool "unknown_tool" is not allowed in code mode.'
            )
        })

        it('does not throw for allowed tools', () => {
            // Code mode
            expect(() => validateToolUse('write_to_file' as ToolName, codeMode)).not.toThrow()

            // Architect mode
            expect(() => validateToolUse('read_file' as ToolName, architectMode)).not.toThrow()

            // Ask mode
            expect(() => validateToolUse('browser_action' as ToolName, askMode)).not.toThrow()
        })
    })
})