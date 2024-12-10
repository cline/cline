import { convertToBedrockConverseMessages, convertToAnthropicMessage } from '../bedrock-converse-format'
import { Anthropic } from '@anthropic-ai/sdk'
import { ContentBlock, ToolResultContentBlock } from '@aws-sdk/client-bedrock-runtime'
import { StreamEvent } from '../../providers/bedrock'

describe('bedrock-converse-format', () => {
    describe('convertToBedrockConverseMessages', () => {
        test('converts simple text messages correctly', () => {
            const messages: Anthropic.Messages.MessageParam[] = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there' }
            ]

            const result = convertToBedrockConverseMessages(messages)

            expect(result).toEqual([
                {
                    role: 'user',
                    content: [{ text: 'Hello' }]
                },
                {
                    role: 'assistant',
                    content: [{ text: 'Hi there' }]
                }
            ])
        })

        test('converts messages with images correctly', () => {
            const messages: Anthropic.Messages.MessageParam[] = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Look at this image:'
                        },
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                data: 'SGVsbG8=', // "Hello" in base64
                                media_type: 'image/jpeg' as const
                            }
                        }
                    ]
                }
            ]

            const result = convertToBedrockConverseMessages(messages)

            if (!result[0] || !result[0].content) {
                fail('Expected result to have content')
                return
            }

            expect(result[0].role).toBe('user')
            expect(result[0].content).toHaveLength(2)
            expect(result[0].content[0]).toEqual({ text: 'Look at this image:' })
            
            const imageBlock = result[0].content[1] as ContentBlock
            if ('image' in imageBlock && imageBlock.image && imageBlock.image.source) {
                expect(imageBlock.image.format).toBe('jpeg')
                expect(imageBlock.image.source).toBeDefined()
                expect(imageBlock.image.source.bytes).toBeDefined()
            } else {
                fail('Expected image block not found')
            }
        })

        test('converts tool use messages correctly', () => {
            const messages: Anthropic.Messages.MessageParam[] = [
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'test-id',
                            name: 'read_file',
                            input: {
                                path: 'test.txt'
                            }
                        }
                    ]
                }
            ]

            const result = convertToBedrockConverseMessages(messages)

            if (!result[0] || !result[0].content) {
                fail('Expected result to have content')
                return
            }

            expect(result[0].role).toBe('assistant')
            const toolBlock = result[0].content[0] as ContentBlock
            if ('toolUse' in toolBlock && toolBlock.toolUse) {
                expect(toolBlock.toolUse).toEqual({
                    toolUseId: 'test-id',
                    name: 'read_file',
                    input: '<read_file>\n<path>\ntest.txt\n</path>\n</read_file>'
                })
            } else {
                fail('Expected tool use block not found')
            }
        })

        test('converts tool result messages correctly', () => {
            const messages: Anthropic.Messages.MessageParam[] = [
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'test-id',
                            content: [{ type: 'text', text: 'File contents here' }]
                        }
                    ]
                }
            ]

            const result = convertToBedrockConverseMessages(messages)

            if (!result[0] || !result[0].content) {
                fail('Expected result to have content')
                return
            }

            expect(result[0].role).toBe('assistant')
            const resultBlock = result[0].content[0] as ContentBlock
            if ('toolResult' in resultBlock && resultBlock.toolResult) {
                const expectedContent: ToolResultContentBlock[] = [
                    { text: 'File contents here' }
                ]
                expect(resultBlock.toolResult).toEqual({
                    toolUseId: 'test-id',
                    content: expectedContent,
                    status: 'success'
                })
            } else {
                fail('Expected tool result block not found')
            }
        })

        test('handles text content correctly', () => {
            const messages: Anthropic.Messages.MessageParam[] = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Hello world'
                        }
                    ]
                }
            ]

            const result = convertToBedrockConverseMessages(messages)

            if (!result[0] || !result[0].content) {
                fail('Expected result to have content')
                return
            }

            expect(result[0].role).toBe('user')
            expect(result[0].content).toHaveLength(1)
            const textBlock = result[0].content[0] as ContentBlock
            expect(textBlock).toEqual({ text: 'Hello world' })
        })
    })

    describe('convertToAnthropicMessage', () => {
        test('converts metadata events correctly', () => {
            const event: StreamEvent = {
                metadata: {
                    usage: {
                        inputTokens: 10,
                        outputTokens: 20
                    }
                }
            }

            const result = convertToAnthropicMessage(event, 'test-model')

            expect(result).toEqual({
                id: '',
                type: 'message',
                role: 'assistant',
                model: 'test-model',
                usage: {
                    input_tokens: 10,
                    output_tokens: 20
                }
            })
        })

        test('converts content block start events correctly', () => {
            const event: StreamEvent = {
                contentBlockStart: {
                    start: {
                        text: 'Hello'
                    }
                }
            }

            const result = convertToAnthropicMessage(event, 'test-model')

            expect(result).toEqual({
                type: 'message',
                role: 'assistant',
                content: [{ type: 'text', text: 'Hello' }],
                model: 'test-model'
            })
        })

        test('converts content block delta events correctly', () => {
            const event: StreamEvent = {
                contentBlockDelta: {
                    delta: {
                        text: ' world'
                    }
                }
            }

            const result = convertToAnthropicMessage(event, 'test-model')

            expect(result).toEqual({
                type: 'message',
                role: 'assistant',
                content: [{ type: 'text', text: ' world' }],
                model: 'test-model'
            })
        })

        test('converts message stop events correctly', () => {
            const event: StreamEvent = {
                messageStop: {
                    stopReason: 'end_turn' as const
                }
            }

            const result = convertToAnthropicMessage(event, 'test-model')

            expect(result).toEqual({
                type: 'message',
                role: 'assistant',
                stop_reason: 'end_turn',
                stop_sequence: null,
                model: 'test-model'
            })
        })
    })
})
