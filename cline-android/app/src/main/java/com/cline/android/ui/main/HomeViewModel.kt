package com.cline.android.ui.main

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.cline.android.repository.database.entities.ProjectEntity
import kotlinx.coroutines.launch

class HomeViewModel : ViewModel() {
    
    private val _recentProjects = MutableLiveData<List<ProjectEntity>>()
    val recentProjects: LiveData<List<ProjectEntity>> = _recentProjects
    
    init {
        loadRecentProjects()
    }
    
    private fun loadRecentProjects() {
        viewModelScope.launch {
            // TODO: Load recent projects from database
            // For now, show empty list
            _recentProjects.value = emptyList()
        }
    }
}