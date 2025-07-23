package com.cline.android.repository.database

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.cline.android.repository.database.converters.DateConverter
import com.cline.android.repository.database.dao.ChatDao
import com.cline.android.repository.database.dao.FileDao
import com.cline.android.repository.database.dao.ProjectDao
import com.cline.android.repository.database.dao.SettingsDao
import com.cline.android.repository.database.entities.ChatEntity
import com.cline.android.repository.database.entities.FileEntity
import com.cline.android.repository.database.entities.MessageEntity
import com.cline.android.repository.database.entities.ProjectEntity
import com.cline.android.repository.database.entities.SettingsEntity

@Database(
    entities = [
        ChatEntity::class,
        MessageEntity::class,
        FileEntity::class,
        ProjectEntity::class,
        SettingsEntity::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(DateConverter::class)
abstract class ClineDatabase : RoomDatabase() {
    abstract fun chatDao(): ChatDao
    abstract fun fileDao(): FileDao
    abstract fun projectDao(): ProjectDao
    abstract fun settingsDao(): SettingsDao
}