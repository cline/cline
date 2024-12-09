import { OpenRouterHandler } from '../openrouter'
import { ApiHandlerOptions, ModelInfo } from '../../../shared/api'
import OpenAI from 'openai'
import axios from 'axios'
import { Anthropic } from '@anthropic-ai/sdk'

// Mock dependencies
jest.mock('openai')
jest.mock('axios')
jest.mock('delay', () => jest.fn(() => Promise.resolve()))

describe('OpenRouterHandler', () => {
    const mockOptions: ApiHandlerOptions = {
        openRouterApiKey: 'test-key',
        openRouterModelId: 'test-model',
        openRouterModelInfo: {
            name: 'Test Model',
            description: 'Test Description',
            maxTokens: 1000,
            contextWindow: 2000,
            supportsPromptCache: true,
            inputPrice: 0.01,
            outputPrice: 0.02
        } as ModelInfo
    }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('constructor initializes with correct options', () => {
        const handler = new OpenRouterHandler(mockOptions)
        expect(handler).toBeInstanceOf(OpenRouterHandler)
        expect(OpenAI).toHaveBeenCalledWith({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: mockOptions.openRouterApiKey,
            defaultHeaders: {
                'HTTP-Referer': 'https://github.com/RooVetGit/Roo-Cline',
                'X-Title': 'Roo-Cline',
            },
        })
    })

    test('getModel returns correct model info when options are provided', () => {
        const handler = new OpenRouterHandler(mockOptions)
        const result = handler.getModel()
        
        expect(result).toEqual({
            id: mockOptions.openRouterModelId,
            info: mockOptions.openRouterModelInfo
        })
    })

    test('createMessage generates correct stream chunks', async () => {
        const handler = new OpenRouterHandler(mockOptions)
        const mockStream = {
            async *[Symbol.asyncIterator]() {
                yield {
                    id: 'test-id',
                    choices: [{
                        delta: {
                            content: 'test response'
                        }
                    }]
                }
            }
        }

        // Mock OpenAI chat.completions.create
        const mockCreate = jest.fn().mockResolvedValue(mockStream)
        ;(OpenAI as jest.MockedClass<typeof OpenAI>).prototype.chat = {
            completions: { create: mockCreate }
        } as any

        // Mock axios.get for generation details
        ;(axios.get as jest.Mock).mockResolvedValue({
            data: {
                data: {
                    native_tokens_prompt: 10,
                    native_tokens_completion: 20,
                    total_cost: 0.001
                }
            }
        })

        const systemPrompt = 'test system prompt'
        const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user' as const, content: 'test message' }]

        const generator = handler.createMessage(systemPrompt, messages)
        const chunks = []
        
        for await (const chunk of generator) {
            chunks.push(chunk)
        }

        // Verify stream chunks
        expect(chunks).toHaveLength(2) // One text chunk and one usage chunk
        expect(chunks[0]).toEqual({
            type: 'text',
            text: 'test response'
        })
        expect(chunks[1]).toEqual({
            type: 'usage',
            inputTokens: 10,
            outputTokens: 20,
            totalCost: 0.001,
            fullResponseText: 'test response'
        })

        // Verify OpenAI client was called with correct parameters
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            model: mockOptions.openRouterModelId,
            temperature: 0,
            messages: expect.arrayContaining([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'test message' }
            ]),
            stream: true
        }))
    })
})
