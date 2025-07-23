package com.cline.android.repository.database.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.Date

@Entity(tableName = "projects")
data class ProjectEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val name: String,
    val rootPath: String,
    val createdAt: Date = Date(),
    val lastOpened: Date = Date()
)