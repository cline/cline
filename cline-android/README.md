# Cline Android

Android adaptation of the Cline VS Code extension - an AI coding assistant for mobile development.

## Features

- **AI Chat Interface**: Interact with AI models (Claude, OpenAI, etc.) for coding assistance
- **Project Management**: Create, import, and manage coding projects on Android
- **Code Editor**: Built-in code editor with syntax highlighting for multiple languages
- **Terminal Emulation**: Execute commands and scripts directly on the device
- **File Management**: Browse, create, edit, and organize project files
- **Settings**: Configure API keys, models, themes, and preferences
- **Dark/Light Theme**: Automatic theme switching based on system preferences

## Architecture

### Database Layer (Room)
- **ChatEntity**: Store chat conversations and history
- **MessageEntity**: Individual messages within chats
- **ProjectEntity**: Project information and metadata
- **FileEntity**: File tracking and content management
- **SettingsEntity**: User preferences and configuration

### Services
- **ApiService**: Interface with AI model APIs (Claude, OpenAI, etc.)
- **FileService**: File operations and project management
- **TerminalService**: Command execution and terminal emulation

### UI Components
- **MainActivity**: Main navigation with bottom tabs
- **HomeFragment**: Dashboard with recent projects and quick actions
- **ChatFragment**: AI chat interface with message history
- **ProjectListFragment**: Project browser and management
- **SettingsFragment**: Configuration and preferences

## Dependencies

### Core Android
- Kotlin
- AndroidX libraries
- Material Design Components
- Navigation Component
- ViewBinding

### Database
- Room (SQLite abstraction)
- Coroutines for async operations

### Networking
- Retrofit for API calls
- OkHttp for HTTP client
- Gson for JSON parsing

### UI/UX
- RecyclerView for lists
- ConstraintLayout for responsive design
- Material Design theming

### Code Editor (Planned)
- Sora Editor for syntax highlighting
- Language support for Java, Kotlin, Python, JavaScript, etc.

### Terminal (Planned)
- Termux integration for command execution
- Shell command support

## Setup

1. Clone the repository
2. Open in Android Studio
3. Sync Gradle dependencies
4. Configure API keys in settings
5. Build and run on Android device/emulator

## Configuration

### API Keys
Configure your AI model API keys in the Settings screen:
- OpenAI API key for GPT models
- Anthropic API key for Claude models
- Other supported providers

### Supported Models
- GPT-4, GPT-3.5-turbo (OpenAI)
- Claude-3 (Anthropic)
- Custom API endpoints

## File Structure

```
cline-android/
├── app/
│   ├── src/main/
│   │   ├── java/com/cline/android/
│   │   │   ├── models/           # Data models
│   │   │   ├── repository/       # Database layer
│   │   │   ├── services/         # Business logic
│   │   │   ├── ui/              # UI components
│   │   │   └── utils/           # Utility functions
│   │   ├── res/                 # Resources
│   │   └── AndroidManifest.xml
│   └── build.gradle
├── build.gradle
└── settings.gradle
```

## Permissions

The app requires the following permissions:
- `INTERNET`: For API calls to AI models
- `READ_EXTERNAL_STORAGE`: For importing projects
- `WRITE_EXTERNAL_STORAGE`: For saving files
- `MANAGE_EXTERNAL_STORAGE`: For full file system access (Android 11+)

## Building APK

To build the APK:

```bash
./gradlew assembleDebug
```

The APK will be generated in `app/build/outputs/apk/debug/`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is based on the original Cline VS Code extension and follows the same licensing terms.