package com.cline.android.ui.chat

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.cline.android.models.Message
import com.cline.android.repository.ChatRepository
import com.cline.android.repository.database.entities.ChatEntity
import com.cline.android.repository.database.entities.MessageEntity
import kotlinx.coroutines.launch
import java.util.Date

class ChatViewModel(private val chatRepository: ChatRepository) : ViewModel() {

    private val _messages = MutableLiveData<List<MessageEntity>>(emptyList())
    val messages: LiveData<List<MessageEntity>> = _messages
    
    private val _isLoading = MutableLiveData<Boolean>(false)
    val isLoading: LiveData<Boolean> = _isLoading
    
    private var currentChatId: Long = 0
    
    init {
        viewModelScope.launch {
            // Create a new chat session
            val chat = ChatEntity(
                title = "New Chat",
                createdAt = System.currentTimeMillis()
            )
            currentChatId = chatRepository.createChat(chat)
            
            // Load messages for this chat
            loadMessages()
        }
    }
    
    fun sendMessage(content: String) {
        if (content.isBlank() || _isLoading.value == true) return
        
        viewModelScope.launch {
            // Add user message
            val userMessage = MessageEntity(
                chatId = currentChatId,
                content = content,
                isUser = true,
                timestamp = System.currentTimeMillis()
            )
            chatRepository.addMessage(userMessage)
            
            // Show loading state
            _isLoading.value = true
            
            // Get response from AI
            try {
                val response = chatRepository.getAiResponse(currentChatId, content)
                
                // Add AI response
                val assistantMessage = MessageEntity(
                    chatId = currentChatId,
                    content = response,
                    isUser = false,
                    timestamp = System.currentTimeMillis()
                )
                chatRepository.addMessage(assistantMessage)
            } catch (e: Exception) {
                // Handle error
                val errorMessage = MessageEntity(
                    chatId = currentChatId,
                    content = "Error: ${e.message ?: "Unknown error"}",
                    isUser = false,
                    timestamp = System.currentTimeMillis()
                )
                chatRepository.addMessage(errorMessage)
            } finally {
                // Hide loading state
                _isLoading.value = false
                
                // Reload messages
                loadMessages()
            }
        }
    }
    
    private fun loadMessages() {
        viewModelScope.launch {
            val chatMessages = chatRepository.getMessagesForChat(currentChatId)
            _messages.value = chatMessages
        }
    }
    
    fun clearChat() {
        viewModelScope.launch {
            chatRepository.clearChat(currentChatId)
            loadMessages()
        }
    }
}