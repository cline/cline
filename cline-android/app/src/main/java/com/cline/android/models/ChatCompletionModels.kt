package com.cline.android.models

/**
 * Request model for chat completions
 */
data class ChatCompletionRequest(
    val model: String,
    val messages: List<Message>,
    val temperature: Double = 0.7,
    val max_tokens: Int = 1000,
    val stream: Boolean = false
)

/**
 * Message model for chat completions
 */
data class Message(
    val role: String, // "user", "assistant", "system"
    val content: String
)

/**
 * Response model for chat completions
 */
data class ChatCompletionResponse(
    val id: String,
    val model: String,
    val choices: List<Choice>,
    val usage: Usage?
)

/**
 * Choice model for chat completions
 */
data class Choice(
    val index: Int,
    val message: Message,
    val finish_reason: String?
)

/**
 * Usage model for chat completions
 */
data class Usage(
    val prompt_tokens: Int,
    val completion_tokens: Int,
    val total_tokens: Int
)