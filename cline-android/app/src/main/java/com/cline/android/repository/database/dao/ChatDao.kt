package com.cline.android.repository.database.dao

import androidx.lifecycle.LiveData
import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import com.cline.android.repository.database.entities.ChatEntity
import com.cline.android.repository.database.entities.MessageEntity

@Dao
interface ChatDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertChat(chat: ChatEntity): Long
    
    @Update
    suspend fun updateChat(chat: ChatEntity)
    
    @Delete
    suspend fun deleteChat(chat: ChatEntity)
    
    @Query("SELECT * FROM chats ORDER BY updatedAt DESC")
    fun getAllChats(): LiveData<List<ChatEntity>>
    
    @Query("SELECT * FROM chats WHERE id = :chatId")
    suspend fun getChatById(chatId: Long): ChatEntity?
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: MessageEntity): Long
    
    @Query("SELECT * FROM messages WHERE chatId = :chatId ORDER BY timestamp ASC")
    fun getMessagesForChat(chatId: Long): LiveData<List<MessageEntity>>
    
    @Transaction
    suspend fun deleteChatWithMessages(chatId: Long) {
        deleteMessages(chatId)
        deleteChat(chatId)
    }
    
    @Query("DELETE FROM messages WHERE chatId = :chatId")
    suspend fun deleteMessages(chatId: Long)
    
    @Query("DELETE FROM chats WHERE id = :chatId")
    suspend fun deleteChat(chatId: Long)
}