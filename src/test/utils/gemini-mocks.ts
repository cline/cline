/**
 * Mock utilities for Gemini API tests.
 * This module provides factories for creating standardized mock objects
 * to simulate Google Generative AI responses and streams in unit tests.
 */

import { EnhancedGenerateContentResponse } from "@google/generative-ai"
import { ApiStream, ApiStreamChunk, ApiStreamTextChunk, ApiStreamUsageChunk } from "../../api/transform/stream"

/**
 * Options for configuring a mock Gemini response.
 */
export interface MockGeminiResponseOptions {
	/** The text content to return */
	text?: string
	/** The finish reason (STOP, MAX_TOKENS, SAFETY, RECITATION, OTHER) */
	finishReason?: string
	/** Number of prompt tokens consumed */
	promptTokens?: number
	/** Number of completion tokens generated */
	completionTokens?: number
	/** Whether to simulate an error in text() method */
	textError?: boolean
}

/**
 * Creates a mock Gemini response object for use in tests.
 *
 * @param options - Configuration options for the mock response
 * @returns A mock EnhancedGenerateContentResponse
 *
 * @example
 * // Create a basic successful response
 * const response = createMockGeminiResponse({
 *   text: "Hello, world!",
 *   promptTokens: 10,
 *   completionTokens: 3
 * });
 *
 * @example
 * // Create a response that was stopped for safety reasons
 * const response = createMockGeminiResponse({
 *   text: "I apologize...",
 *   finishReason: "SAFETY",
 *   promptTokens: 15,
 *   completionTokens: 2
 * });
 */
export function createMockGeminiResponse(options: MockGeminiResponseOptions = {}): EnhancedGenerateContentResponse {
	const textFn = options.textError
		? () => {
				throw new Error("Simulated text error")
			}
		: () => options.text || ""

	// Create a mock with minimal required fields
	const mock = {
		text: textFn,
		candidates: options.finishReason ? [{ finishReason: options.finishReason }] : [],
		usageMetadata: {
			promptTokenCount: options.promptTokens || 0,
			candidatesTokenCount: options.completionTokens || 0,
		},
		// Add stub implementations for required methods
		functionCall: undefined,
		functionCalls: [],
	}

	// Use double type assertion for incomplete mocks
	return mock as unknown as EnhancedGenerateContentResponse
}

/**
 * Options for configuring a mock Gemini stream.
 */
export interface MockGeminiStreamOptions {
	/** Text chunks to include in the stream */
	textChunks?: string[]
	/** The finish reason (STOP, MAX_TOKENS, SAFETY, RECITATION, OTHER) */
	finishReason?: string
	/** Number of prompt tokens consumed */
	promptTokens?: number
	/** Number of completion tokens generated */
	completionTokens?: number
	/** Error to throw during stream generation (for error testing) */
	streamError?: Error
	/** Error to throw during response retrieval (for error testing) */
	responseError?: Error
	/** Whether to return null for the final response (for error testing) */
	nullResponse?: boolean
}

/**
 * Creates a mock generateContentStream result for use in tests.
 *
 * @param options - Configuration options for the mock stream
 * @returns An object with stream and response properties
 *
 * @example
 * // Create a basic streaming response
 * const streamResult = createMockGeminiStream({
 *   textChunks: ["Hello, ", "world!"],
 *   promptTokens: 5,
 *   completionTokens: 2
 * });
 *
 * @example
 * // Create a stream that fails
 * const streamResult = createMockGeminiStream({
 *   textChunks: ["Starting response..."],
 *   streamError: new Error("Network error")
 * });
 */
export function createMockGeminiStream(options: MockGeminiStreamOptions = {}) {
	if (options.streamError) {
		throw options.streamError
	}

	const textChunks = options.textChunks || []

	// Create the stream generator
	async function* fakeStream() {
		for (const chunk of textChunks) {
			yield { text: () => chunk }
		}
	}

	// Create the response promise
	let responsePromise: Promise<EnhancedGenerateContentResponse | null>

	if (options.responseError) {
		responsePromise = Promise.reject(options.responseError)
	} else if (options.nullResponse) {
		responsePromise = Promise.resolve(null)
	} else {
		const response = {
			usageMetadata: {
				promptTokenCount: options.promptTokens || 0,
				candidatesTokenCount: options.completionTokens || 0,
			},
			candidates: options.finishReason ? [{ finishReason: options.finishReason }] : [],
			// Add missing required properties
			text: () => textChunks.join(""),
			functionCall: undefined,
			functionCalls: [],
		}

		responsePromise = Promise.resolve(response as unknown as EnhancedGenerateContentResponse)
	}

	return {
		stream: fakeStream(),
		response: responsePromise,
	}
}

/**
 * Creates a mock ApiStream for direct testing of stream consumers.
 *
 * @param chunks - API stream chunks to yield
 * @param error - Optional error to throw during stream generation
 * @returns An AsyncGenerator implementing the ApiStream interface
 *
 * @example
 * // Create a stream with text and usage chunks
 * const stream = createMockApiStream([
 *   { type: "text", text: "Hello, world!" },
 *   { type: "usage", inputTokens: 5, outputTokens: 3 }
 * ]);
 *
 * @example
 * // Create a stream that throws an error
 * const stream = createMockApiStream(
 *   [{ type: "text", text: "Partial response" }],
 *   new Error("Stream interrupted")
 * );
 */
export async function* createMockApiStream(chunks: ApiStreamChunk[], error?: Error): ApiStream {
	for (const chunk of chunks) {
		if (error) {
			throw error
		}
		yield chunk
	}
}

/**
 * Creates a model object with a mock generateContentStream method.
 * Useful for injecting into the GeminiHandler's client property.
 *
 * @param streamOptions - Options for the generated stream
 * @returns A model object with generateContentStream method
 *
 * @example
 * // Create a model that returns a normal stream
 * const mockModel = createMockGeminiModel({
 *   textChunks: ["Hello, ", "world!"],
 *   promptTokens: 10,
 *   completionTokens: 5
 * });
 *
 * // Inject into handler
 * handler["client"] = {
 *   getGenerativeModel: () => mockModel
 * } as any;
 */
export function createMockGeminiModel(streamOptions: MockGeminiStreamOptions = {}) {
	return {
		generateContentStream: async () => createMockGeminiStream(streamOptions),
		generateContent: async () =>
			createMockGeminiResponse({
				text: streamOptions.textChunks?.join("") || "",
				finishReason: streamOptions.finishReason,
				promptTokens: streamOptions.promptTokens,
				completionTokens: streamOptions.completionTokens,
			}),
	}
}
