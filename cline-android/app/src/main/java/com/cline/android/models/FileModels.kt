package com.cline.android.models

/**
 * Model for file information
 */
data class FileInfo(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val size: Long,
    val lastModified: Long
)

/**
 * Model for project information
 */
data class ProjectInfo(
    val id: Long = 0,
    val name: String,
    val rootPath: String,
    val createdAt: Long,
    val lastOpened: Long
)