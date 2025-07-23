package com.cline.android.ui.project

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.cline.android.repository.database.entities.ProjectEntity
import kotlinx.coroutines.launch

class ProjectListViewModel : ViewModel() {
    
    private val _projects = MutableLiveData<List<ProjectEntity>>()
    val projects: LiveData<List<ProjectEntity>> = _projects
    
    init {
        loadProjects()
    }
    
    private fun loadProjects() {
        viewModelScope.launch {
            // TODO: Load projects from database
            // For now, show empty list
            _projects.value = emptyList()
        }
    }
    
    fun createProject(name: String, rootPath: String) {
        viewModelScope.launch {
            // TODO: Create new project in database
        }
    }
    
    fun deleteProject(project: ProjectEntity) {
        viewModelScope.launch {
            // TODO: Delete project from database
        }
    }
}