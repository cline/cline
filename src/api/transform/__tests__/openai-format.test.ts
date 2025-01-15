import { convertToOpenAiMessages, convertToAnthropicMessage } from '../openai-format';
import { Anthropic } from '@anthropic-ai/sdk';
import OpenAI from 'openai';

type PartialChatCompletion = Omit<OpenAI.Chat.Completions.ChatCompletion, 'choices'> & {
    choices: Array<Partial<OpenAI.Chat.Completions.ChatCompletion.Choice> & {
        message: OpenAI.Chat.Completions.ChatCompletion.Choice['message'];
        finish_reason: string;
        index: number;
    }>;
};

describe('OpenAI Format Transformations', () => {
    describe('convertToOpenAiMessages', () => {
        it('should convert simple text messages', () => {
            const anthropicMessages: Anthropic.Messages.MessageParam[] = [
                {
                    role: 'user',
                    content: 'Hello'
                },
                {
                    role: 'assistant',
                    content: 'Hi there!'
                }
            ];

            const openAiMessages = convertToOpenAiMessages(anthropicMessages);
            expect(openAiMessages).toHaveLength(2);
            expect(openAiMessages[0]).toEqual({
                role: 'user',
                content: 'Hello'
            });
            expect(openAiMessages[1]).toEqual({
                role: 'assistant',
                content: 'Hi there!'
            });
        });

        it('should handle messages with image content', () => {
            const anthropicMessages: Anthropic.Messages.MessageParam[] = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'What is in this image?'
                        },
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: 'image/jpeg',
                                data: 'base64data'
                            }
                        }
                    ]
                }
            ];

            const openAiMessages = convertToOpenAiMessages(anthropicMessages);
            expect(openAiMessages).toHaveLength(1);
            expect(openAiMessages[0].role).toBe('user');
            
            const content = openAiMessages[0].content as Array<{
                type: string;
                text?: string;
                image_url?: { url: string };
            }>;
            
            expect(Array.isArray(content)).toBe(true);
            expect(content).toHaveLength(2);
            expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' });
            expect(content[1]).toEqual({
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,base64data' }
            });
        });

        it('should handle assistant messages with tool use', () => {
            const anthropicMessages: Anthropic.Messages.MessageParam[] = [
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'text',
                            text: 'Let me check the weather.'
                        },
                        {
                            type: 'tool_use',
                            id: 'weather-123',
                            name: 'get_weather',
                            input: { city: 'London' }
                        }
                    ]
                }
            ];

            const openAiMessages = convertToOpenAiMessages(anthropicMessages);
            expect(openAiMessages).toHaveLength(1);
            
            const assistantMessage = openAiMessages[0] as OpenAI.Chat.ChatCompletionAssistantMessageParam;
            expect(assistantMessage.role).toBe('assistant');
            expect(assistantMessage.content).toBe('Let me check the weather.');
            expect(assistantMessage.tool_calls).toHaveLength(1);
            expect(assistantMessage.tool_calls![0]).toEqual({
                id: 'weather-123',
                type: 'function',
                function: {
                    name: 'get_weather',
                    arguments: JSON.stringify({ city: 'London' })
                }
            });
        });

        it('should handle user messages with tool results', () => {
            const anthropicMessages: Anthropic.Messages.MessageParam[] = [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'weather-123',
                            content: 'Current temperature in London: 20°C'
                        }
                    ]
                }
            ];

            const openAiMessages = convertToOpenAiMessages(anthropicMessages);
            expect(openAiMessages).toHaveLength(1);
            
            const toolMessage = openAiMessages[0] as OpenAI.Chat.ChatCompletionToolMessageParam;
            expect(toolMessage.role).toBe('tool');
            expect(toolMessage.tool_call_id).toBe('weather-123');
            expect(toolMessage.content).toBe('Current temperature in London: 20°C');
        });
    });

    describe('convertToAnthropicMessage', () => {
        it('should convert simple completion', () => {
            const openAiCompletion: PartialChatCompletion = {
                id: 'completion-123',
                model: 'gpt-4',
                choices: [{
                    message: {
                        role: 'assistant',
                        content: 'Hello there!',
                        refusal: null
                    },
                    finish_reason: 'stop',
                    index: 0
                }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15
                },
                created: 123456789,
                object: 'chat.completion'
            };

            const anthropicMessage = convertToAnthropicMessage(openAiCompletion as OpenAI.Chat.Completions.ChatCompletion);
            expect(anthropicMessage.id).toBe('completion-123');
            expect(anthropicMessage.role).toBe('assistant');
            expect(anthropicMessage.content).toHaveLength(1);
            expect(anthropicMessage.content[0]).toEqual({
                type: 'text',
                text: 'Hello there!'
            });
            expect(anthropicMessage.stop_reason).toBe('end_turn');
            expect(anthropicMessage.usage).toEqual({
                input_tokens: 10,
                output_tokens: 5
            });
        });

        it('should handle tool calls in completion', () => {
            const openAiCompletion: PartialChatCompletion = {
                id: 'completion-123',
                model: 'gpt-4',
                choices: [{
                    message: {
                        role: 'assistant',
                        content: 'Let me check the weather.',
                        tool_calls: [{
                            id: 'weather-123',
                            type: 'function',
                            function: {
                                name: 'get_weather',
                                arguments: '{"city":"London"}'
                            }
                        }],
                        refusal: null
                    },
                    finish_reason: 'tool_calls',
                    index: 0
                }],
                usage: {
                    prompt_tokens: 15,
                    completion_tokens: 8,
                    total_tokens: 23
                },
                created: 123456789,
                object: 'chat.completion'
            };

            const anthropicMessage = convertToAnthropicMessage(openAiCompletion as OpenAI.Chat.Completions.ChatCompletion);
            expect(anthropicMessage.content).toHaveLength(2);
            expect(anthropicMessage.content[0]).toEqual({
                type: 'text',
                text: 'Let me check the weather.'
            });
            expect(anthropicMessage.content[1]).toEqual({
                type: 'tool_use',
                id: 'weather-123',
                name: 'get_weather',
                input: { city: 'London' }
            });
            expect(anthropicMessage.stop_reason).toBe('tool_use');
        });

        it('should handle invalid tool call arguments', () => {
            const openAiCompletion: PartialChatCompletion = {
                id: 'completion-123',
                model: 'gpt-4',
                choices: [{
                    message: {
                        role: 'assistant',
                        content: 'Testing invalid arguments',
                        tool_calls: [{
                            id: 'test-123',
                            type: 'function',
                            function: {
                                name: 'test_function',
                                arguments: 'invalid json'
                            }
                        }],
                        refusal: null
                    },
                    finish_reason: 'tool_calls',
                    index: 0
                }],
                created: 123456789,
                object: 'chat.completion'
            };

            const anthropicMessage = convertToAnthropicMessage(openAiCompletion as OpenAI.Chat.Completions.ChatCompletion);
            expect(anthropicMessage.content).toHaveLength(2);
            expect(anthropicMessage.content[1]).toEqual({
                type: 'tool_use',
                id: 'test-123',
                name: 'test_function',
                input: {}  // Should default to empty object for invalid JSON
            });
        });
    });
});