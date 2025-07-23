package com.cline.android.utils

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream

/**
 * Utility functions for file operations
 */
object FileUtils {
    
    /**
     * Create a temporary directory in the app's cache directory
     */
    fun createTempDirectory(context: Context, dirName: String): File {
        val cacheDir = context.cacheDir
        val tempDir = File(cacheDir, dirName)
        if (!tempDir.exists()) {
            tempDir.mkdirs()
        }
        return tempDir
    }
    
    /**
     * Get the file name from a URI
     */
    fun getFileName(context: Context, uri: Uri): String {
        var result: String? = null
        if (uri.scheme == "content") {
            val cursor: Cursor? = context.contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex != -1) {
                        result = it.getString(nameIndex)
                    }
                }
            }
        }
        if (result == null) {
            result = uri.path
            val cut = result?.lastIndexOf('/')
            if (cut != -1) {
                result = result?.substring(cut!! + 1)
            }
        }
        return result ?: "unknown_file"
    }
    
    /**
     * Check if an input stream is a ZIP file
     */
    fun isZipFile(inputStream: InputStream?): Boolean {
        if (inputStream == null) return false
        
        return try {
            val signature = ByteArray(4)
            val read = inputStream.read(signature)
            
            // ZIP file signature: 0x50 0x4B 0x03 0x04
            read == 4 && 
                    signature[0].toInt() == 0x50 && 
                    signature[1].toInt() == 0x4B && 
                    signature[2].toInt() == 0x03 && 
                    signature[3].toInt() == 0x04
        } catch (e: IOException) {
            false
        } finally {
            try {
                inputStream.reset()
            } catch (e: IOException) {
                // Ignore
            }
        }
    }
    
    /**
     * Extract a ZIP file to a directory
     */
    fun extractZip(inputStream: InputStream, destinationDir: File) {
        val buffer = ByteArray(1024)
        val zis = ZipInputStream(inputStream)
        
        var zipEntry: ZipEntry? = zis.nextEntry
        while (zipEntry != null) {
            val newFile = File(destinationDir, zipEntry.name)
            
            // Create directories if needed
            if (zipEntry.isDirectory) {
                newFile.mkdirs()
            } else {
                // Create parent directories if needed
                newFile.parentFile?.mkdirs()
                
                // Extract file
                FileOutputStream(newFile).use { fos ->
                    var len: Int
                    while (zis.read(buffer).also { len = it } > 0) {
                        fos.write(buffer, 0, len)
                    }
                }
            }
            
            zipEntry = zis.nextEntry
        }
        
        zis.closeEntry()
        zis.close()
    }
    
    /**
     * Get the file extension from a path
     */
    fun getFileExtension(path: String): String {
        val lastDot = path.lastIndexOf('.')
        return if (lastDot > 0) {
            path.substring(lastDot + 1)
        } else {
            ""
        }
    }
    
    /**
     * Determine the language based on file extension
     */
    fun getLanguageFromExtension(extension: String): String {
        return when (extension.lowercase()) {
            "java" -> "java"
            "kt", "kts" -> "kotlin"
            "js", "jsx", "ts", "tsx" -> "javascript"
            "py" -> "python"
            "html", "htm" -> "html"
            "css" -> "css"
            "json" -> "json"
            "xml" -> "xml"
            "md" -> "markdown"
            "c", "cpp", "h", "hpp" -> "cpp"
            "cs" -> "csharp"
            "go" -> "go"
            "rs" -> "rust"
            "rb" -> "ruby"
            "php" -> "php"
            "swift" -> "swift"
            "dart" -> "dart"
            "sh", "bash" -> "shell"
            "sql" -> "sql"
            "yaml", "yml" -> "yaml"
            else -> "plaintext"
        }
    }
}