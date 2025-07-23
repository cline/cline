package com.cline.android.repository.database.dao

import androidx.lifecycle.LiveData
import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.cline.android.repository.database.entities.FileEntity

@Dao
interface FileDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertFile(file: FileEntity): Long
    
    @Update
    suspend fun updateFile(file: FileEntity)
    
    @Delete
    suspend fun deleteFile(file: FileEntity)
    
    @Query("SELECT * FROM files WHERE projectId = :projectId AND isDirectory = 0 ORDER BY name ASC")
    fun getFilesForProject(projectId: Long): LiveData<List<FileEntity>>
    
    @Query("SELECT * FROM files WHERE projectId = :projectId AND isDirectory = 1 ORDER BY name ASC")
    fun getDirectoriesForProject(projectId: Long): LiveData<List<FileEntity>>
    
    @Query("SELECT * FROM files WHERE id = :fileId")
    suspend fun getFileById(fileId: Long): FileEntity?
    
    @Query("SELECT * FROM files WHERE path = :path AND projectId = :projectId")
    suspend fun getFileByPath(path: String, projectId: Long): FileEntity?
    
    @Query("DELETE FROM files WHERE projectId = :projectId")
    suspend fun deleteFilesForProject(projectId: Long)
}