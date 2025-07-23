package com.cline.android.repository.database.dao

import androidx.lifecycle.LiveData
import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.cline.android.repository.database.entities.SettingsEntity

@Dao
interface SettingsDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSetting(setting: SettingsEntity)
    
    @Query("SELECT * FROM settings WHERE key = :key")
    suspend fun getSetting(key: String): SettingsEntity?
    
    @Query("SELECT value FROM settings WHERE key = :key")
    suspend fun getSettingValue(key: String): String?
    
    @Query("SELECT * FROM settings")
    fun getAllSettings(): LiveData<List<SettingsEntity>>
    
    @Query("DELETE FROM settings WHERE key = :key")
    suspend fun deleteSetting(key: String)
}