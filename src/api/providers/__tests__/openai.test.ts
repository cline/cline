import { OpenAiHandler } from '../openai'
import { ApiHandlerOptions, openAiModelInfoSaneDefaults } from '../../../shared/api'
import OpenAI, { AzureOpenAI } from 'openai'
import { Anthropic } from '@anthropic-ai/sdk'

// Mock dependencies
jest.mock('openai')

describe('OpenAiHandler', () => {
    const mockOptions: ApiHandlerOptions = {
        openAiApiKey: 'test-key',
        openAiModelId: 'gpt-4',
        openAiStreamingEnabled: true,
        openAiBaseUrl: 'https://api.openai.com/v1'
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('constructor initializes with correct options', () => {
        const handler = new OpenAiHandler(mockOptions)
        expect(handler).toBeInstanceOf(OpenAiHandler)
        expect(OpenAI).toHaveBeenCalledWith({
            apiKey: mockOptions.openAiApiKey,
            baseURL: mockOptions.openAiBaseUrl
        })
    })

    test('constructor initializes Azure client when Azure URL is provided', () => {
        const azureOptions: ApiHandlerOptions = {
            ...mockOptions,
            openAiBaseUrl: 'https://example.azure.com',
            azureApiVersion: '2023-05-15'
        }
        const handler = new OpenAiHandler(azureOptions)
        expect(handler).toBeInstanceOf(OpenAiHandler)
        expect(AzureOpenAI).toHaveBeenCalledWith({
            baseURL: azureOptions.openAiBaseUrl,
            apiKey: azureOptions.openAiApiKey,
            apiVersion: azureOptions.azureApiVersion
        })
    })

    test('getModel returns correct model info', () => {
        const handler = new OpenAiHandler(mockOptions)
        const result = handler.getModel()
        
        expect(result).toEqual({
            id: mockOptions.openAiModelId,
            info: openAiModelInfoSaneDefaults
        })
    })

    test('createMessage handles streaming correctly when enabled', async () => {
        const handler = new OpenAiHandler({
            ...mockOptions,
            openAiStreamingEnabled: true,
            includeMaxTokens: true
        })
        
        const mockStream = {
            async *[Symbol.asyncIterator]() {
                yield {
                    choices: [{
                        delta: {
                            content: 'test response'
                        }
                    }],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 5
                    }
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

        expect(chunks).toEqual([
            {
                type: 'text',
                text: 'test response'
            },
            {
                type: 'usage',
                inputTokens: 10,
                outputTokens: 5
            }
        ])

        expect(mockCreate).toHaveBeenCalledWith({
            model: mockOptions.openAiModelId,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'test message' }
            ],
            temperature: 0,
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: openAiModelInfoSaneDefaults.maxTokens
        })
    })

    test('createMessage handles non-streaming correctly when disabled', async () => {
        const handler = new OpenAiHandler({
            ...mockOptions,
            openAiStreamingEnabled: false
        })
        
        const mockResponse = {
            choices: [{
                message: {
                    content: 'test response'
                }
            }],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5
            }
        }

        const mockCreate = jest.fn().mockResolvedValue(mockResponse)
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

        expect(chunks).toEqual([
            {
                type: 'text',
                text: 'test response'
            },
            {
                type: 'usage',
                inputTokens: 10,
                outputTokens: 5
            }
        ])

        expect(mockCreate).toHaveBeenCalledWith({
            model: mockOptions.openAiModelId,
            messages: [
                { role: 'user', content: systemPrompt },
                { role: 'user', content: 'test message' }
            ]
        })
    })

    test('createMessage handles API errors', async () => {
        const handler = new OpenAiHandler(mockOptions)
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