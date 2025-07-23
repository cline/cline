package com.cline.android.repository.database.dao

import androidx.lifecycle.LiveData
import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.cline.android.repository.database.entities.ProjectEntity
import java.util.Date

@Dao
interface ProjectDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProject(project: ProjectEntity): Long
    
    @Update
    suspend fun updateProject(project: ProjectEntity)
    
    @Delete
    suspend fun deleteProject(project: ProjectEntity)
    
    @Query("SELECT * FROM projects ORDER BY lastOpened DESC")
    fun getAllProjects(): LiveData<List<ProjectEntity>>
    
    @Query("SELECT * FROM projects WHERE id = :projectId")
    suspend fun getProjectById(projectId: Long): ProjectEntity?
    
    @Query("SELECT * FROM projects WHERE rootPath = :rootPath")
    suspend fun getProjectByPath(rootPath: String): ProjectEntity?
    
    @Query("UPDATE projects SET lastOpened = :lastOpened WHERE id = :projectId")
    suspend fun updateLastOpened(projectId: Long, lastOpened: Date = Date())
}