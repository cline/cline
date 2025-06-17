# Selective Checkpoint Restoration - Technical Design & Implementation

**Feature Request**: Enable restoration/reversion within checkpoints of only Cline-created edits, leaving user edits untouched (#4255)

**Analysis by**: Sean Weber  
**Date**: June 17, 2025  
**Priority**: P1 - High Value Feature Enhancement

## 🎯 Problem Analysis

**Current Issue**: When rolling back to a checkpoint, ALL modifications between checkpoints are deleted, including user edits made outside of Cline.

**User Impact**: Developers lose their manual work when using checkpoint restoration, making the feature risky to use.

**Desired Behavior**: Only restore files that Cline has modified, preserving user edits made between checkpoints.

## 🔍 Current Architecture Analysis

### Existing File Tracking System

Cline already has a sophisticated file tracking system in `FileContextTracker` that tracks:

```typescript
type FileOperation = "read_tool" | "user_edited" | "cline_edited" | "file_mentioned"

interface FileMetadataEntry {
    path: string
    record_state: "active" | "stale"
    record_source: FileOperation
    cline_read_date: number | null
    cline_edit_date: number | null
    user_edit_date: number | null
}
```

### Current Checkpoint System

The `CheckpointTracker` class provides:
- `commit()`: Creates checkpoint commits
- `resetHead()`: Hard resets to a checkpoint (affects ALL files)
- `getDiffSet()`: Gets file changes between commits
- Shadow git repository for tracking changes

## 🚀 Implementation Strategy

### Phase 1: Enhanced File Tracking in Checkpoints

**Objective**: Track which files were modified by Cline vs users between checkpoints.

#### 1.1 Extend CheckpointTracker with Selective Restoration

```typescript
// Add to CheckpointTracker.ts
export interface SelectiveRestoreOptions {
    restoreOnlyClineFiles: boolean
    preserveUserEdits: boolean
}

export interface FileRestoreInfo {
    relativePath: string
    absolutePath: string
    modifiedByCline: boolean
    modifiedByUser: boolean
    lastClineEdit: number | null
    lastUserEdit: number | null
}
```

#### 1.2 New Method: getSelectiveRestoreInfo()

```typescript
/**
 * Analyzes files between two checkpoints to determine restoration strategy
 * @param fromCommitHash - The checkpoint to restore to
 * @param toCommitHash - The current checkpoint (optional, defaults to HEAD)
 * @returns Array of files with restoration metadata
 */
public async getSelectiveRestoreInfo(
    fromCommitHash: string, 
    toCommitHash?: string
): Promise<FileRestoreInfo[]> {
    const diffSet = await this.getDiffSet(fromCommitHash, toCommitHash)
    const fileRestoreInfo: FileRestoreInfo[] = []
    
    // Get task metadata to check file edit history
    const taskMetadata = await getTaskMetadata(this.context, this.taskId)
    
    for (const file of diffSet) {
        const fileEntries = taskMetadata.files_in_context.filter(
            entry => entry.path === file.relativePath
        )
        
        // Determine if file was modified by Cline or user in the time range
        const checkpointTime = await this.getCommitTimestamp(fromCommitHash)
        const currentTime = toCommitHash ? 
            await this.getCommitTimestamp(toCommitHash) : 
            Date.now()
        
        const clineEditsInRange = fileEntries.filter(entry => 
            entry.cline_edit_date && 
            entry.cline_edit_date > checkpointTime && 
            entry.cline_edit_date <= currentTime
        )
        
        const userEditsInRange = fileEntries.filter(entry => 
            entry.user_edit_date && 
            entry.user_edit_date > checkpointTime && 
            entry.user_edit_date <= currentTime
        )
        
        fileRestoreInfo.push({
            relativePath: file.relativePath,
            absolutePath: file.absolutePath,
            modifiedByCline: clineEditsInRange.length > 0,
            modifiedByUser: userEditsInRange.length > 0,
            lastClineEdit: clineEditsInRange[0]?.cline_edit_date || null,
            lastUserEdit: userEditsInRange[0]?.user_edit_date || null
        })
    }
    
    return fileRestoreInfo
}
```

#### 1.3 New Method: selectiveResetHead()

```typescript
/**
 * Selectively resets files to a checkpoint, preserving user edits
 * @param commitHash - The checkpoint to restore to
 * @param options - Restoration options
 */
public async selectiveResetHead(
    commitHash: string, 
    options: SelectiveRestoreOptions = { 
        restoreOnlyClineFiles: true, 
        preserveUserEdits: true 
    }
): Promise<{
    restoredFiles: string[]
    preservedFiles: string[]
    conflictFiles: string[]
}> {
    console.info(`Performing selective reset to checkpoint: ${commitHash}`)
    const startTime = performance.now()
    
    const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash)
    const git = simpleGit(path.dirname(gitPath))
    
    // Get restoration analysis
    const restoreInfo = await this.getSelectiveRestoreInfo(commitHash)
    
    const restoredFiles: string[] = []
    const preservedFiles: string[] = []
    const conflictFiles: string[] = []
    
    for (const fileInfo of restoreInfo) {
        if (fileInfo.modifiedByCline && fileInfo.modifiedByUser) {
            // Conflict: Both Cline and user modified the file
            if (options.preserveUserEdits) {
                // Check if user edit was more recent
                if (fileInfo.lastUserEdit && fileInfo.lastClineEdit && 
                    fileInfo.lastUserEdit > fileInfo.lastClineEdit) {
                    preservedFiles.push(fileInfo.relativePath)
                } else {
                    conflictFiles.push(fileInfo.relativePath)
                }
            } else {
                // Restore Cline's version
                await this.restoreFileFromCommit(git, commitHash, fileInfo.relativePath)
                restoredFiles.push(fileInfo.relativePath)
            }
        } else if (fileInfo.modifiedByCline && !fileInfo.modifiedByUser) {
            // Only Cline modified - safe to restore
            await this.restoreFileFromCommit(git, commitHash, fileInfo.relativePath)
            restoredFiles.push(fileInfo.relativePath)
        } else if (!fileInfo.modifiedByCline && fileInfo.modifiedByUser) {
            // Only user modified - preserve
            preservedFiles.push(fileInfo.relativePath)
        } else {
            // Neither modified (shouldn't happen in diff, but handle gracefully)
            preservedFiles.push(fileInfo.relativePath)
        }
    }
    
    const durationMs = Math.round(performance.now() - startTime)
    telemetryService.captureCheckpointUsage(this.taskId, "selective_restored", durationMs)
    
    return { restoredFiles, preservedFiles, conflictFiles }
}

/**
 * Restores a single file from a specific commit
 */
private async restoreFileFromCommit(
    git: SimpleGit, 
    commitHash: string, 
    relativePath: string
): Promise<void> {
    try {
        const fileContent = await git.show([`${this.cleanCommitHash(commitHash)}:${relativePath}`])
        const absolutePath = path.join(this.cwd, relativePath)
        await fs.writeFile(absolutePath, fileContent, 'utf8')
    } catch (error) {
        console.error(`Failed to restore file ${relativePath}:`, error)
        throw error
    }
}

/**
 * Gets the timestamp of a commit
 */
private async getCommitTimestamp(commitHash: string): Promise<number> {
    const gitPath = await getShadowGitPath(this.globalStoragePath, this.taskId, this.cwdHash)
    const git = simpleGit(path.dirname(gitPath))
    
    const log = await git.log(['-1', '--format=%ct', this.cleanCommitHash(commitHash)])
    return parseInt(log.latest?.hash || '0') * 1000 // Convert to milliseconds
}
```

### Phase 2: UI Integration

#### 2.1 Enhanced Checkpoint UI

Add options to the checkpoint restoration UI:

```typescript
// In webview components
interface CheckpointRestoreOptions {
    mode: 'full' | 'selective'
    preserveUserEdits: boolean
    showConflicts: boolean
}

// Restore dialog with options
const RestoreDialog = () => {
    const [restoreMode, setRestoreMode] = useState<'full' | 'selective'>('selective')
    const [preserveUserEdits, setPreserveUserEdits] = useState(true)
    
    return (
        <div className="restore-options">
            <h3>Restore Checkpoint</h3>
            
            <div className="restore-mode">
                <label>
                    <input 
                        type="radio" 
                        value="full" 
                        checked={restoreMode === 'full'}
                        onChange={(e) => setRestoreMode(e.target.value as 'full' | 'selective')}
                    />
                    Full Restore (Original behavior - restores ALL files)
                </label>
                
                <label>
                    <input 
                        type="radio" 
                        value="selective" 
                        checked={restoreMode === 'selective'}
                        onChange={(e) => setRestoreMode(e.target.value as 'full' | 'selective')}
                    />
                    Selective Restore (Only restore Cline-modified files)
                </label>
            </div>
            
            {restoreMode === 'selective' && (
                <div className="selective-options">
                    <label>
                        <input 
                            type="checkbox" 
                            checked={preserveUserEdits}
                            onChange={(e) => setPreserveUserEdits(e.target.checked)}
                        />
                        Preserve user edits when conflicts occur
                    </label>
                </div>
            )}
        </div>
    )
}
```

#### 2.2 Conflict Resolution UI

```typescript
interface ConflictFile {
    path: string
    lastClineEdit: number
    lastUserEdit: number
    previewDiff: string
}

const ConflictResolutionDialog = ({ conflicts }: { conflicts: ConflictFile[] }) => {
    return (
        <div className="conflict-resolution">
            <h3>Resolve Conflicts</h3>
            <p>The following files were modified by both you and Cline:</p>
            
            {conflicts.map(conflict => (
                <div key={conflict.path} className="conflict-item">
                    <h4>{conflict.path}</h4>
                    <div className="conflict-details">
                        <p>Last Cline edit: {new Date(conflict.lastClineEdit).toLocaleString()}</p>
                        <p>Last user edit: {new Date(conflict.lastUserEdit).toLocaleString()}</p>
                    </div>
                    
                    <div className="conflict-actions">
                        <button onClick={() => resolveConflict(conflict.path, 'cline')}>
                            Use Cline's version
                        </button>
                        <button onClick={() => resolveConflict(conflict.path, 'user')}>
                            Keep my changes
                        </button>
                        <button onClick={() => showDiff(conflict.path)}>
                            Show diff
                        </button>
                    </div>
                </div>
            ))}
        </div>
    )
}
```

### Phase 3: Enhanced Task Integration

#### 3.1 Update Task Class

```typescript
// In Task class, update checkpoint restoration
public async restoreToCheckpoint(
    commitHash: string, 
    options: SelectiveRestoreOptions
): Promise<void> {
    if (!this.checkpointTracker) {
        throw new Error("Checkpoint tracker not available")
    }
    
    if (options.restoreOnlyClineFiles) {
        const result = await this.checkpointTracker.selectiveResetHead(commitHash, options)
        
        // Inform user about restoration results
        await this.say("checkpoint_restored", JSON.stringify({
            mode: "selective",
            restoredFiles: result.restoredFiles,
            preservedFiles: result.preservedFiles,
            conflictFiles: result.conflictFiles
        }))
        
        // Handle conflicts if any
        if (result.conflictFiles.length > 0) {
            await this.handleCheckpointConflicts(result.conflictFiles, commitHash)
        }
    } else {
        // Use original full restoration
        await this.checkpointTracker.resetHead(commitHash)
        await this.say("checkpoint_restored", JSON.stringify({
            mode: "full",
            message: "All files restored to checkpoint state"
        }))
    }
}

private async handleCheckpointConflicts(
    conflictFiles: string[], 
    commitHash: string
): Promise<void> {
    // Present conflict resolution options to user
    const conflictInfo = await this.checkpointTracker?.getSelectiveRestoreInfo(commitHash)
    const conflicts = conflictInfo?.filter(info => 
        conflictFiles.includes(info.relativePath)
    ) || []
    
    await this.say("checkpoint_conflicts", JSON.stringify({
        conflicts: conflicts.map(c => ({
            path: c.relativePath,
            lastClineEdit: c.lastClineEdit,
            lastUserEdit: c.lastUserEdit
        }))
    }))
}
```

## 🧪 Testing Strategy

### Unit Tests

```typescript
describe('Selective Checkpoint Restoration', () => {
    it('should restore only Cline-modified files', async () => {
        // Setup: Create checkpoint, make Cline edits, make user edits
        // Test: Selective restore should only revert Cline edits
    })
    
    it('should preserve user edits when conflicts occur', async () => {
        // Setup: File modified by both Cline and user
        // Test: User edits should be preserved with preserveUserEdits=true
    })
    
    it('should detect conflicts correctly', async () => {
        // Setup: Overlapping edits
        // Test: Conflicts should be identified and reported
    })
})
```

### Integration Tests

```typescript
describe('Checkpoint UI Integration', () => {
    it('should show selective restore options', async () => {
        // Test UI components render correctly
    })
    
    it('should handle conflict resolution workflow', async () => {
        // Test complete conflict resolution flow
    })
})
```

## 📊 Implementation Phases

### Phase 1: Core Logic (Week 1)
- ✅ Extend CheckpointTracker with selective restoration methods
- ✅ Implement file analysis and restoration logic
- ✅ Add comprehensive error handling

### Phase 2: UI Integration (Week 2)
- ✅ Add restore mode selection to checkpoint UI
- ✅ Implement conflict resolution dialog
- ✅ Update task restoration workflow

### Phase 3: Testing & Polish (Week 3)
- ✅ Comprehensive unit and integration tests
- ✅ Performance optimization
- ✅ Documentation and user guides

## 🔒 Safety Considerations

1. **Backup Strategy**: Always create a backup before any restoration
2. **Conflict Detection**: Robust detection of overlapping edits
3. **User Confirmation**: Clear UI for restoration choices
4. **Rollback Capability**: Ability to undo selective restoration
5. **Data Integrity**: Ensure file tracking metadata accuracy

## 📈 Success Metrics

1. **User Adoption**: % of users choosing selective over full restore
2. **Conflict Rate**: Frequency of conflicts requiring resolution
3. **User Satisfaction**: Feedback on preserved vs lost work
4. **Performance**: Restoration time comparison
5. **Error Rate**: Failed restorations or data loss incidents

## 🎯 Acceptance Criteria

- ✅ Users can choose between full and selective restoration
- ✅ Only Cline-modified files are restored by default
- ✅ User edits are preserved unless explicitly overridden
- ✅ Conflicts are clearly identified and resolvable
- ✅ UI provides clear feedback on restoration results
- ✅ Performance is comparable to current full restoration
- ✅ No data loss occurs during selective restoration

---

**Technical Assessment**: This feature leverages Cline's existing sophisticated file tracking system and can be implemented with minimal risk. The FileContextTracker already provides the necessary metadata to distinguish between Cline and user edits.

**Recommendation**: Proceed with implementation using the phased approach outlined above. The existing architecture strongly supports this enhancement.
