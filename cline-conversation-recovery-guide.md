# Cline Conversation History Recovery Guide

**Date:** October 4, 2025  
**Purpose:** Recover lost conversation history from orphaned task files  
**Target Users:** Users experiencing conversation history loss due to race conditions

---

## Understanding What Can Be Recovered

### Good News: Your Data Likely Still Exists!

When conversations "disappear" from the Cline UI, the actual conversation data is usually **still on disk**. The problem is that the `taskHistory.json` index file lost the reference to your task, making it invisible to the UI.

### What Gets Lost vs. What Persists

**Lost (Index File):**
- ❌ Entry in `taskHistory.json` (just metadata/pointer)
- ❌ UI visibility of the conversation

**Persists on Disk:**
- ✅ `api_conversation_history.json` - Full conversation with Claude
- ✅ `ui_messages.json` - All UI messages and state
- ✅ `task_metadata.json` - Files used, model info, tokens
- ✅ `settings.json` - Task-specific settings
- ✅ File contents referenced in the conversation

---

## Locating Your Lost Conversations

### Step 1: Find the Global Storage Directory

The location varies by platform:

**macOS:**
```
~/Library/Application Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev/
```

**Linux:**
```
~/.config/VSCodium/User/globalStorage/saoudrizwan.claude-dev/
```

**Windows:**
```
%APPDATA%\VSCodium\User\globalStorage\saoudrizwan.claude-dev\
```

### Step 2: Locate Task Directories

Navigate to the `tasks/` subdirectory:
```
{globalStorageFsPath}/tasks/{taskId}/
```

Each task has a unique ID (ULID format). List all directories to see all tasks:

```bash
# macOS/Linux
ls -la ~/Library/Application\ Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev/tasks/

# Or use find to see all task directories
find ~/Library/Application\ Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev/tasks/ -type d -maxdepth 1
```

### Step 3: Identify Orphaned Tasks

Compare the task IDs on disk with entries in `taskHistory.json`:

```bash
# Location of taskHistory.json
~/Library/Application Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev/state/taskHistory.json
```

Any task directory without a corresponding entry in `taskHistory.json` is orphaned.

---

## Recovery Methods

## Method 1: Manual Recovery (Safest)

### What You'll Do:
Manually inspect orphaned task directories and add them back to `taskHistory.json`.

### Steps:

1. **Backup Current State**
   ```bash
   cd ~/Library/Application\ Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev/state/
   cp taskHistory.json taskHistory.json.backup
   ```

2. **Open taskHistory.json**
   ```bash
   code taskHistory.json
   ```

3. **Inspect Orphaned Task**
   Navigate to a task directory and read `ui_messages.json`:
   ```bash
   cd ~/Library/Application\ Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev/tasks/01HX1234567890ABCDEFGHIJK/
   cat ui_messages.json | jq '.[0].text' # First message (usually the user's task)
   ```

4. **Extract Task Information**
   From `ui_messages.json`, you need:
   - First message text (the task)
   - Timestamp of first message
   - Task ID (directory name)

5. **Create History Entry**
   Add an entry to `taskHistory.json`:
   ```json
   {
     "id": "01HX1234567890ABCDEFGHIJK",
     "ts": 1704067200000,
     "task": "The original task description from first message",
     "tokensIn": 0,
     "tokensOut": 0,
     "cacheWrites": 0,
     "cacheReads": 0,
     "totalCost": 0
   }
   ```

6. **Save and Restart VSCode**

---

## Method 2: Semi-Automated Recovery Script

### Recovery Script (Node.js)

Create a file `recover-conversations.js`:

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

// Determine global storage path based on platform
function getGlobalStoragePath() {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  } else if (platform === 'linux') {
    return path.join(homeDir, '.config', 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA, 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  }
  
  throw new Error('Unsupported platform');
}

async function recoverOrphanedTasks() {
  const storagePath = getGlobalStoragePath();
  const tasksDir = path.join(storagePath, 'tasks');
  const historyFile = path.join(storagePath, 'state', 'taskHistory.json');
  
  console.log('📂 Storage path:', storagePath);
  console.log('📋 Tasks directory:', tasksDir);
  console.log('📄 History file:', historyFile);
  
  // 1. Read current taskHistory.json
  let taskHistory = [];
  if (fs.existsSync(historyFile)) {
    try {
      taskHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      console.log(`✅ Loaded ${taskHistory.length} existing history entries`);
    } catch (error) {
      console.error('❌ Failed to parse taskHistory.json:', error.message);
      console.log('Creating new taskHistory array...');
    }
  } else {
    console.log('⚠️  taskHistory.json not found, will create new one');
  }
  
  // Create a Set of existing task IDs for fast lookup
  const existingIds = new Set(taskHistory.map(item => item.id));
  
  // 2. Scan tasks directory
  const taskDirs = fs.readdirSync(tasksDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  console.log(`📁 Found ${taskDirs.length} task directories on disk`);
  
  // 3. Find orphaned tasks
  const orphanedTasks = [];
  
  for (const taskId of taskDirs) {
    if (!existingIds.has(taskId)) {
      const taskDir = path.join(tasksDir, taskId);
      const uiMessagesFile = path.join(taskDir, 'ui_messages.json');
      
      if (fs.existsSync(uiMessagesFile)) {
        try {
          const messages = JSON.parse(fs.readFileSync(uiMessagesFile, 'utf8'));
          
          if (messages.length > 0) {
            // Extract first user message as task description
            const firstMessage = messages.find(m => m.type === 'ask' && m.ask === 'command') 
                               || messages[0];
            
            const taskText = firstMessage?.text || 'Recovered conversation';
            const timestamp = firstMessage?.ts || Date.now();
            
            orphanedTasks.push({
              id: taskId,
              ts: timestamp,
              task: taskText,
              tokensIn: 0,
              tokensOut: 0,
              cacheWrites: 0,
              cacheReads: 0,
              totalCost: 0,
              _recovered: true  // Mark as recovered for reference
            });
            
            console.log(`🔍 Found orphaned task: ${taskId}`);
            console.log(`   Task: ${taskText.substring(0, 60)}...`);
          }
        } catch (error) {
          console.error(`⚠️  Could not read ui_messages.json for ${taskId}:`, error.message);
        }
      }
    }
  }
  
  console.log(`\n🎯 Found ${orphanedTasks.length} orphaned tasks to recover`);
  
  if (orphanedTasks.length === 0) {
    console.log('✨ No orphaned tasks found - everything looks good!');
    return;
  }
  
  // 4. Backup current taskHistory.json
  const backupFile = `${historyFile}.backup-${Date.now()}`;
  if (fs.existsSync(historyFile)) {
    fs.copyFileSync(historyFile, backupFile);
    console.log(`💾 Backed up current taskHistory.json to:`);
    console.log(`   ${backupFile}`);
  }
  
  // 5. Merge orphaned tasks into history
  const recoveredHistory = [...orphanedTasks, ...taskHistory];
  
  // Sort by timestamp (newest first)
  recoveredHistory.sort((a, b) => b.ts - a.ts);
  
  // 6. Write updated taskHistory.json
  fs.writeFileSync(historyFile, JSON.stringify(recoveredHistory, null, 2));
  
  console.log(`\n✅ Successfully recovered ${orphanedTasks.length} conversations!`);
  console.log(`📊 Total conversations in history: ${recoveredHistory.length}`);
  console.log(`\n🔄 Please restart VSCode/VSCodium to see recovered conversations.`);
}

// Run recovery
recoverOrphanedTasks().catch(error => {
  console.error('❌ Recovery failed:', error);
  process.exit(1);
});
```

### Usage:

```bash
# Save the script
cd ~/Desktop
nano recover-conversations.js
# (paste the script above)

# Make it executable
chmod +x recover-conversations.js

# Run it
node recover-conversations.js
```

---

## Method 3: Advanced Recovery with Metadata

### Enhanced Script with Full Metadata

This version extracts token counts and other metadata:

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

function getGlobalStoragePath() {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  } else if (platform === 'linux') {
    return path.join(homeDir, '.config', 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA, 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  }
  
  throw new Error('Unsupported platform');
}

async function recoverWithMetadata() {
  const storagePath = getGlobalStoragePath();
  const tasksDir = path.join(storagePath, 'tasks');
  const historyFile = path.join(storagePath, 'state', 'taskHistory.json');
  
  // Read current history
  let taskHistory = [];
  if (fs.existsSync(historyFile)) {
    taskHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  }
  
  const existingIds = new Set(taskHistory.map(item => item.id));
  const taskDirs = fs.readdirSync(tasksDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  const orphanedTasks = [];
  
  for (const taskId of taskDirs) {
    if (!existingIds.has(taskId)) {
      const taskDir = path.join(tasksDir, taskId);
      const uiMessagesFile = path.join(taskDir, 'ui_messages.json');
      const metadataFile = path.join(taskDir, 'task_metadata.json');
      
      let taskEntry = {
        id: taskId,
        ts: Date.now(),
        task: 'Recovered conversation',
        tokensIn: 0,
        tokensOut: 0,
        cacheWrites: 0,
        cacheReads: 0,
        totalCost: 0
      };
      
      // Extract from ui_messages.json
      if (fs.existsSync(uiMessagesFile)) {
        try {
          const messages = JSON.parse(fs.readFileSync(uiMessagesFile, 'utf8'));
          if (messages.length > 0) {
            const firstMessage = messages.find(m => m.type === 'ask' && m.ask === 'command') || messages[0];
            taskEntry.task = firstMessage?.text || taskEntry.task;
            taskEntry.ts = firstMessage?.ts || taskEntry.ts;
            
            // Calculate tokens from all API request messages
            messages.forEach(msg => {
              if (msg.type === 'say' && msg.say === 'api_req_started' && msg.text) {
                try {
                  const apiData = JSON.parse(msg.text);
                  taskEntry.tokensIn += apiData.tokensIn || 0;
                  taskEntry.tokensOut += apiData.tokensOut || 0;
                  taskEntry.cacheWrites += apiData.cacheWrites || 0;
                  taskEntry.cacheReads += apiData.cacheReads || 0;
                  taskEntry.totalCost += apiData.cost || 0;
                } catch {}
              }
            });
          }
        } catch (error) {
          console.error(`Could not read ui_messages for ${taskId}:`, error.message);
        }
      }
      
      // Extract from task_metadata.json
      if (fs.existsSync(metadataFile)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
          
          // Add model usage info if available
          if (metadata.model_usage && metadata.model_usage.length > 0) {
            const totalUsage = metadata.model_usage.reduce((acc, usage) => ({
              tokensIn: acc.tokensIn + (usage.input_tokens || 0),
              tokensOut: acc.tokensOut + (usage.output_tokens || 0),
              cacheWrites: acc.cacheWrites + (usage.cache_creation_input_tokens || 0),
              cacheReads: acc.cacheReads + (usage.cache_read_input_tokens || 0)
            }), { tokensIn: 0, tokensOut: 0, cacheWrites: 0, cacheReads: 0 });
            
            // Use metadata values if messages didn't have them
            if (taskEntry.tokensIn === 0) taskEntry.tokensIn = totalUsage.tokensIn;
            if (taskEntry.tokensOut === 0) taskEntry.tokensOut = totalUsage.tokensOut;
            if (taskEntry.cacheWrites === 0) taskEntry.cacheWrites = totalUsage.cacheWrites;
            if (taskEntry.cacheReads === 0) taskEntry.cacheReads = totalUsage.cacheReads;
          }
        } catch (error) {
          console.error(`Could not read metadata for ${taskId}:`, error.message);
        }
      }
      
      orphanedTasks.push(taskEntry);
      console.log(`Recovered: ${taskEntry.task.substring(0, 60)}... (${taskEntry.tokensIn + taskEntry.tokensOut} tokens)`);
    }
  }
  
  if (orphanedTasks.length === 0) {
    console.log('No orphaned tasks found!');
    return;
  }
  
  // Backup and write
  const backupFile = `${historyFile}.backup-${Date.now()}`;
  if (fs.existsSync(historyFile)) {
    fs.copyFileSync(historyFile, backupFile);
  }
  
  const recoveredHistory = [...orphanedTasks, ...taskHistory];
  recoveredHistory.sort((a, b) => b.ts - a.ts);
  
  fs.writeFileSync(historyFile, JSON.stringify(recoveredHistory, null, 2));
  
  console.log(`\n✅ Recovered ${orphanedTasks.length} conversations with full metadata!`);
}

recoverWithMetadata().catch(console.error);
```

---

## Method 4: Export to Markdown (Preserve Data)

If you want to preserve conversations as readable markdown files:

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

function getGlobalStoragePath() {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  } else if (platform === 'linux') {
    return path.join(homeDir, '.config', 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA, 'VSCodium', 'User', 'globalStorage', 'saoudrizwan.claude-dev');
  }
  
  throw new Error('Unsupported platform');
}

async function exportToMarkdown() {
  const storagePath = getGlobalStoragePath();
  const tasksDir = path.join(storagePath, 'tasks');
  const outputDir = path.join(os.homedir(), 'Desktop', 'cline-recovery');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const taskDirs = fs.readdirSync(tasksDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  console.log(`Exporting ${taskDirs.length} conversations to markdown...`);
  
  for (const taskId of taskDirs) {
    const taskDir = path.join(tasksDir, taskId);
    const uiMessagesFile = path.join(taskDir, 'ui_messages.json');
    
    if (fs.existsSync(uiMessagesFile)) {
      try {
        const messages = JSON.parse(fs.readFileSync(uiMessagesFile, 'utf8'));
        
        let markdown = `# Cline Conversation: ${taskId}\n\n`;
        markdown += `**Date:** ${new Date(messages[0]?.ts || Date.now()).toLocaleString()}\n\n`;
        markdown += `---\n\n`;
        
        messages.forEach(msg => {
          if (msg.type === 'ask' && msg.ask === 'command') {
            markdown += `## 👤 User\n\n${msg.text}\n\n---\n\n`;
          } else if (msg.type === 'say' && msg.say === 'text') {
            markdown += `## 🤖 Claude\n\n${msg.text}\n\n---\n\n`;
          } else if (msg.type === 'say' && msg.say === 'completion_result') {
            markdown += `## ✅ Task Complete\n\n${msg.text}\n\n---\n\n`;
          }
        });
        
        const filename = `conversation-${taskId}.md`;
        fs.writeFileSync(path.join(outputDir, filename), markdown);
        console.log(`✓ Exported ${filename}`);
      } catch (error) {
        console.error(`Failed to export ${taskId}:`, error.message);
      }
    }
  }
  
  console.log(`\n✅ Exported all conversations to: ${outputDir}`);
}

exportToMarkdown().catch(console.error);
```

---

## Recovery Checklist

### Before Recovery:
- [ ] Close all VSCode/VSCodium windows
- [ ] Backup entire global storage directory
- [ ] Note down current number of visible conversations

### During Recovery:
- [ ] Run chosen recovery method
- [ ] Verify backup was created
- [ ] Check output for errors

### After Recovery:
- [ ] Restart VSCode/VSCodium
- [ ] Check conversation history panel
- [ ] Verify recovered conversations are accessible
- [ ] Test opening a recovered conversation

---

## Troubleshooting

### Issue: Script says "No orphaned tasks found" but I know I lost conversations

**Solution:** The task might still be in `taskHistory.json` but corrupted. Try:
1. Export all tasks to markdown first (Method 4)
2. Check if the conversation data exists in the exported files
3. Manually compare taskHistory.json IDs with disk directories

### Issue: Recovered conversations appear but won't open

**Possible causes:**
1. Corrupted JSON in `ui_messages.json`
2. Missing required fields in task files
3. Workspace path mismatch

**Solution:**
Try the markdown export (Method 4) to at least preserve the content.

### Issue: Script fails with "Cannot find module"

**Solution:**
Make sure you're using Node.js to run the script:
```bash
node recover-conversations.js
```

### Issue: Permission denied

**Solution:**
```bash
chmod +x recover-conversations.js
# Or run with sudo (not recommended for home directory)
```

---

## Prevention: Backup Strategy

### Automated Backup Script

Create a cron job or scheduled task to backup conversations:

```bash
#!/bin/bash
# backup-cline.sh

STORAGE_PATH="$HOME/Library/Application Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev"
BACKUP_PATH="$HOME/Desktop/cline-backups"
DATE=$(date +%Y-%m-%d-%H%M%S)

mkdir -p "$BACKUP_PATH"
tar -czf "$BACKUP_PATH/cline-backup-$DATE.tar.gz" "$STORAGE_PATH"

# Keep only last 7 days
find "$BACKUP_PATH" -name "cline-backup-*.tar.gz" -mtime +7 -delete

echo "Backup created: cline-backup-$DATE.tar.gz"
```

Schedule with cron (macOS/Linux):
```bash
crontab -e
# Add this line to backup daily at 2 AM:
0 2 * * * /path/to/backup-cline.sh
```

---

## Summary

### Quick Recovery Steps:

1. **Identify lost conversations**
   - Check `{globalStorage}/tasks/` directory
   - Compare with `state/taskHistory.json`

2. **Choose recovery method**
   - Manual: Safest, slowest
   - Semi-automated script: Balance of safety and convenience
   - Full metadata recovery: Best for preserving all data
   - Markdown export: Best for archival/sharing

3. **Execute recovery**
   - Always backup first
   - Run recovery script
   - Restart VSCode

4. **Verify success**
   - Check conversation history panel
   - Open a recovered conversation
   - Verify content is intact

### Success Rate:

- **High** (90%+): If task files exist and JSON is valid
- **Medium** (50-90%): If some JSON corruption exists
- **Low** (<50%): If files were actually deleted or severely corrupted

**Most users should be able to recover their lost conversations using these methods!**
