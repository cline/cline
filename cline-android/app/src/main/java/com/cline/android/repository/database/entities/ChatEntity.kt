package com.cline.android.repository.database.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.Date

@Entity(tableName = "chats")
data class ChatEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val title: String,
    val projectId: Long?,
    val createdAt: Date = Date(),
    val updatedAt: Date = Date()
)