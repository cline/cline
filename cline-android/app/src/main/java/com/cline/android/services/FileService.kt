package com.cline.android.services

import android.content.Context
import android.net.Uri
import android.util.Log
import com.cline.android.models.FileInfo
import com.cline.android.models.ProjectInfo
import com.cline.android.utils.FileUtils
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Service for managing files and projects
 */
class FileService(private val context: Context) {
    
    private val TAG = "FileService"
    
    /**
     * Create a new file with the given content
     */
    fun createFile(path: String, content: String): Boolean {
        return try {
            val file = File(path)
            if (!file.parentFile?.exists()!!) {
                file.parentFile?.mkdirs()
            }
            
            FileOutputStream(file).use { outputStream ->
                outputStream.write(content.toByteArray())
            }
            true
        } catch (e: IOException) {
            Log.e(TAG, "Error creating file: ${e.message}")
            false
        }
    }
    
    /**
     * Read the content of a file
     */
    fun readFile(path: String): String? {
        return try {
            File(path).readText()
        } catch (e: IOException) {
            Log.e(TAG, "Error reading file: ${e.message}")
            null
        }
    }
    
    /**
     * Update an existing file with new content
     */
    fun updateFile(path: String, content: String): Boolean {
        return try {
            val file = File(path)
            if (!file.exists()) {
                return createFile(path, content)
            }
            
            FileOutputStream(file).use { outputStream ->
                outputStream.write(content.toByteArray())
            }
            true
        } catch (e: IOException) {
            Log.e(TAG, "Error updating file: ${e.message}")
            false
        }
    }
    
    /**
     * Delete a file
     */
    fun deleteFile(path: String): Boolean {
        return try {
            val file = File(path)
            if (file.exists()) {
                file.delete()
            }
            true
        } catch (e: IOException) {
            Log.e(TAG, "Error deleting file: ${e.message}")
            false
        }
    }
    
    /**
     * List files in a directory
     */
    fun listFiles(directoryPath: String): List<FileInfo> {
        val directory = File(directoryPath)
        if (!directory.exists() || !directory.isDirectory) {
            return emptyList()
        }
        
        return directory.listFiles()?.map { file ->
            FileInfo(
                name = file.name,
                path = file.absolutePath,
                isDirectory = file.isDirectory,
                size = if (file.isFile) file.length() else 0,
                lastModified = file.lastModified()
            )
        } ?: emptyList()
    }
    
    /**
     * Create a new project
     */
    fun createProject(name: String, rootPath: String): ProjectInfo? {
        val projectDir = File(rootPath)
        if (!projectDir.exists()) {
            projectDir.mkdirs()
        }
        
        return if (projectDir.exists() && projectDir.isDirectory) {
            ProjectInfo(
                name = name,
                rootPath = rootPath,
                createdAt = System.currentTimeMillis(),
                lastOpened = System.currentTimeMillis()
            )
        } else {
            null
        }
    }
    
    /**
     * Import a project from a URI (e.g., from file picker)
     */
    fun importProjectFromUri(uri: Uri, name: String): ProjectInfo? {
        try {
            val projectDir = FileUtils.createTempDirectory(context, name)
            val inputStream = context.contentResolver.openInputStream(uri)
            
            // If it's a zip file, extract it
            if (FileUtils.isZipFile(inputStream)) {
                inputStream?.close()
                val newInputStream = context.contentResolver.openInputStream(uri)
                FileUtils.extractZip(newInputStream!!, projectDir)
            } else {
                // Otherwise, just copy the file
                val outputFile = File(projectDir, FileUtils.getFileName(context, uri))
                inputStream?.use { input ->
                    FileOutputStream(outputFile).use { output ->
                        input.copyTo(output)
                    }
                }
            }
            
            return ProjectInfo(
                name = name,
                rootPath = projectDir.absolutePath,
                createdAt = System.currentTimeMillis(),
                lastOpened = System.currentTimeMillis()
            )
        } catch (e: IOException) {
            Log.e(TAG, "Error importing project: ${e.message}")
            return null
        }
    }
}