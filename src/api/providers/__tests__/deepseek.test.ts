import { DeepSeekHandler } from '../deepseek'
import { ApiHandlerOptions } from '../../../shared/api'
import OpenAI from 'openai'
import { Anthropic } from '@anthropic-ai/sdk'

// Mock dependencies
jest.mock('openai')
jest.mock('../../../shared/api', () => ({
    ...jest.requireActual('../../../shared/api'),
    deepSeekModels: {
        'deepseek-chat': {
            maxTokens: 1000,
            contextWindow: 2000,
            supportsImages: false,
            supportsPromptCache: false,
            inputPrice: 0.014,
            outputPrice: 0.28,
        }
    }
}))

describe('DeepSeekHandler', () => {

    const mockOptions: ApiHandlerOptions = {
        deepSeekApiKey: 'test-key',
        deepSeekModelId: 'deepseek-chat',
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('constructor initializes with correct options', () => {
        const handler = new DeepSeekHandler(mockOptions)
        expect(handler).toBeInstanceOf(DeepSeekHandler)
        expect(OpenAI).toHaveBeenCalledWith({
            baseURL: 'https://api.deepseek.com/v1',
            apiKey: mockOptions.deepSeekApiKey,
        })
    })

    test('getModel returns correct model info', () => {
        const handler = new DeepSeekHandler(mockOptions)
        const result = handler.getModel()
        
        expect(result).toEqual({
            id: mockOptions.deepSeekModelId,
            info: expect.objectContaining({
                maxTokens: 1000,
                contextWindow: 2000,
                supportsPromptCache: false,
                supportsImages: false,
                inputPrice: 0.014,
                outputPrice: 0.28,
            })
        })
    })

    test('getModel returns default model info when no model specified', () => {
        const handler = new DeepSeekHandler({ deepSeekApiKey: 'test-key' })
        const result = handler.getModel()
        
        expect(result.id).toBe('deepseek-chat')
        expect(result.info.maxTokens).toBe(1000)
    })

    test('createMessage handles string content correctly', async () => {
        const handler = new DeepSeekHandler(mockOptions)
        const mockStream = {
            async *[Symbol.asyncIterator]() {
                yield {
                    choices: [{
                        delta: {
                            content: 'test response'
                        }
                    }]
                }
            }
        }

        const mockCreate = jest.fn().mockResolvedValue(mockStream)
        ;(OpenAI as jest.MockedClass<typeof OpenAI>).prototype.chat = {
            completions: { create: mockCreate }
        } as any

        const systemPrompt = 'test system prompt'
        const messages: Anthropic.Messages.MessageParam[] = [
            { role: 'user', content: 'test message' }
        ]

        const generator = handler.createMessage(systemPrompt, messages)
        const chunks = []
        
        for await (const chunk of generator) {
            chunks.push(chunk)
        }

        expect(chunks).toHaveLength(1)
        expect(chunks[0]).toEqual({
            type: 'text',
            text: 'test response'
        })

        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            model: mockOptions.deepSeekModelId,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'test message' }
            ],
            temperature: 0,
            stream: true,
            max_tokens: 1000,
            stream_options: { include_usage: true }
        }))
    })

    test('createMessage handles complex content correctly', async () => {
        const handler = new DeepSeekHandler(mockOptions)
        const mockStream = {
            async *[Symbol.asyncIterator]() {
                yield {
                    choices: [{
                        delta: {
                            content: 'test response'
                        }
                    }]
                }
            }
        }

        const mockCreate = jest.fn().mockResolvedValue(mockStream)
        ;(OpenAI as jest.MockedClass<typeof OpenAI>).prototype.chat = {
            completions: { create: mockCreate }
        } as any

        const systemPrompt = 'test system prompt'
        const messages: Anthropic.Messages.MessageParam[] = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'part 1' },
                    { type: 'text', text: 'part 2' }
                ]
            }
        ]

        const generator = handler.createMessage(systemPrompt, messages)
        await generator.next()

        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'part 1part 2' }
            ]
        }))
    })

    test('createMessage truncates messages when exceeding context window', async () => {
        const handler = new DeepSeekHandler(mockOptions)
        const longString = 'a'.repeat(1000) // ~300 tokens
        const shortString = 'b'.repeat(100) // ~30 tokens
        
        const systemPrompt = 'test system prompt'
        const messages: Anthropic.Messages.MessageParam[] = [
            { role: 'user', content: longString }, // Old message
            { role: 'assistant', content: 'short response' },
            { role: 'user', content: shortString } // Recent message
        ]

        const mockStream = {
            async *[Symbol.asyncIterator]() {
                yield {
                    choices: [{
                        delta: {
                            content: '(Note: Some earlier messages were truncated to fit within the model\'s context window)\n\n'
                        }
                    }]
                }
                yield {
                    choices: [{
                        delta: {
                            content: 'test response'
                        }
                    }]
                }
            }
        }

        const mockCreate = jest.fn().mockResolvedValue(mockStream)
        ;(OpenAI as jest.MockedClass<typeof OpenAI>).prototype.chat = {
            completions: { create: mockCreate }
        } as any

        const generator = handler.createMessage(systemPrompt, messages)
        const chunks = []
        for await (const chunk of generator) {
            chunks.push(chunk)
        }

        // Should get two chunks: truncation notice and response
        expect(chunks).toHaveLength(2)
        expect(chunks[0]).toEqual({
            type: 'text',
            text: expect.stringContaining('truncated')
        })
        expect(chunks[1]).toEqual({
            type: 'text',
            text: 'test response'
        })

        // Verify API call includes system prompt and recent messages, but not old message
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            messages: expect.arrayContaining([
                { role: 'system', content: systemPrompt },
                { role: 'assistant', content: 'short response' },
                { role: 'user', content: shortString }
            ])
        }))
        
        // Verify truncation notice was included
        expect(chunks[0]).toEqual({
            type: 'text',
            text: expect.stringContaining('truncated')
        })

        // Verify the messages array contains the expected messages
        const calledMessages = mockCreate.mock.calls[0][0].messages
        expect(calledMessages).toHaveLength(4)
        expect(calledMessages[0]).toEqual({ role: 'system', content: systemPrompt })
        expect(calledMessages[1]).toEqual({ role: 'user', content: longString })
        expect(calledMessages[2]).toEqual({ role: 'assistant', content: 'short response' })
        expect(calledMessages[3]).toEqual({ role: 'user', content: shortString })
    })

    test('createMessage handles API errors', async () => {
        const handler = new DeepSeekHandler(mockOptions)
        const mockStream = {
            async *[Symbol.asyncIterator]() {
                throw new Error('API Error')
            }
        }

        const mockCreate = jest.fn().mockResolvedValue(mockStream)
        ;(OpenAI as jest.MockedClass<typeof OpenAI>).prototype.chat = {
            completions: { create: mockCreate }
        } as any

        const generator = handler.createMessage('test', [])
        await expect(generator.next()).rejects.toThrow('API Error')
    })
})