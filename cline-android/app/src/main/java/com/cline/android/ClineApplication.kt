package com.cline.android

import android.app.Application
import android.content.Context
import androidx.room.Room
import com.cline.android.repository.database.ClineDatabase
import com.cline.android.services.ApiService
import com.cline.android.services.FileService
import com.cline.android.services.TerminalService
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

class ClineApplication : Application() {
    
    // Database instance
    lateinit var database: ClineDatabase
        private set
    
    // API service for AI model interactions
    lateinit var apiService: ApiService
        private set
    
    // File service for managing code files
    lateinit var fileService: FileService
        private set
    
    // Terminal service for command execution
    lateinit var terminalService: TerminalService
        private set
    
    override fun onCreate() {
        super.onCreate()
        
        // Initialize database
        database = Room.databaseBuilder(
            applicationContext,
            ClineDatabase::class.java,
            "cline-database"
        ).build()
        
        // Initialize API service
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        
        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor(loggingInterceptor)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
        
        val retrofit = Retrofit.Builder()
            .baseUrl("https://api.anthropic.com/") // Default to Anthropic, can be changed in settings
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
        
        apiService = retrofit.create(ApiService::class.java)
        
        // Initialize file service
        fileService = FileService(applicationContext)
        
        // Initialize terminal service
        terminalService = TerminalService(applicationContext)
    }
    
    companion object {
        fun getInstance(context: Context): ClineApplication {
            return context.applicationContext as ClineApplication
        }
    }
}