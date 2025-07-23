package com.cline.android.services

import com.cline.android.models.ChatCompletionRequest
import com.cline.android.models.ChatCompletionResponse
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

/**
 * Service for interacting with AI model APIs
 */
interface ApiService {
    
    // Anthropic Claude API
    @POST("v1/messages")
    suspend fun getClaudeCompletion(
        @Header("x-api-key") apiKey: String,
        @Header("anthropic-version") version: String = "2023-06-01",
        @Body request: ChatCompletionRequest
    ): ChatCompletionResponse
    
    // OpenAI API
    @POST("v1/chat/completions")
    suspend fun getOpenAICompletion(
        @Header("Authorization") authorization: String,
        @Body request: ChatCompletionRequest
    ): ChatCompletionResponse
}