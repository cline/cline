package com.cline.android.services

import android.content.Context
import android.util.Log
import java.io.BufferedReader
import java.io.File
import java.io.IOException
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext

/**
 * Service for executing terminal commands
 */
class TerminalService(private val context: Context) {
    
    private val TAG = "TerminalService"
    
    /**
     * Execute a command and return the result
     */
    suspend fun executeCommand(command: String, workingDir: String? = null): CommandResult {
        return withContext(Dispatchers.IO) {
            try {
                val processBuilder = ProcessBuilder()
                processBuilder.command("sh", "-c", command)
                
                // Set working directory if provided
                if (workingDir != null) {
                    val workingDirectory = File(workingDir)
                    if (workingDirectory.exists() && workingDirectory.isDirectory) {
                        processBuilder.directory(workingDirectory)
                    }
                }
                
                // Redirect error stream to output stream
                processBuilder.redirectErrorStream(true)
                
                val process = processBuilder.start()
                val reader = BufferedReader(InputStreamReader(process.inputStream))
                val output = StringBuilder()
                var line: String?
                
                // Read output
                while (reader.readLine().also { line = it } != null) {
                    output.append(line).append("\n")
                }
                
                // Wait for process to complete with timeout
                val completed = process.waitFor(30, TimeUnit.SECONDS)
                val exitCode = if (completed) process.exitValue() else -1
                
                CommandResult(
                    exitCode = exitCode,
                    output = output.toString(),
                    command = command
                )
            } catch (e: IOException) {
                Log.e(TAG, "Error executing command: ${e.message}")
                CommandResult(
                    exitCode = -1,
                    output = "Error: ${e.message}",
                    command = command
                )
            } catch (e: InterruptedException) {
                Log.e(TAG, "Command execution interrupted: ${e.message}")
                CommandResult(
                    exitCode = -1,
                    output = "Interrupted: ${e.message}",
                    command = command
                )
            }
        }
    }
    
    /**
     * Execute a command and stream the output as a Flow
     */
    fun executeCommandWithStream(command: String, workingDir: String? = null): Flow<String> = flow {
        try {
            val processBuilder = ProcessBuilder()
            processBuilder.command("sh", "-c", command)
            
            // Set working directory if provided
            if (workingDir != null) {
                val workingDirectory = File(workingDir)
                if (workingDirectory.exists() && workingDirectory.isDirectory) {
                    processBuilder.directory(workingDirectory)
                }
            }
            
            // Redirect error stream to output stream
            processBuilder.redirectErrorStream(true)
            
            val process = processBuilder.start()
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            var line: String?
            
            // Read and emit output line by line
            while (reader.readLine().also { line = it } != null) {
                emit(line ?: "")
            }
            
            // Wait for process to complete
            val exitCode = process.waitFor()
            emit("[Process completed with exit code: $exitCode]")
            
        } catch (e: IOException) {
            Log.e(TAG, "Error executing command: ${e.message}")
            emit("Error: ${e.message}")
        } catch (e: InterruptedException) {
            Log.e(TAG, "Command execution interrupted: ${e.message}")
            emit("Interrupted: ${e.message}")
        }
    }
}

/**
 * Model for command execution result
 */
data class CommandResult(
    val exitCode: Int,
    val output: String,
    val command: String
)