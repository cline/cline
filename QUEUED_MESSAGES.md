# Queued Messages Feature

This feature allows users to send messages even when the AI is currently active and processing other tasks. Instead of being blocked from sending messages, users can queue up their messages, and they will be processed automatically once the AI becomes available.

## How It Works

### User Experience
1. **When AI is busy**: Instead of being unable to send messages, users can type and send messages as usual
2. **Visual feedback**: The UI shows a "messages will be queued" indicator in the input placeholder
3. **Queue display**: A dedicated indicator shows all queued messages with the ability to remove individual messages or clear all
4. **Automatic processing**: Once the AI becomes available, queued messages are processed automatically in FIFO (first-in, first-out) order

### Technical Implementation

#### State Management
- **QueuedMessage Interface**: Defines the structure of queued messages with id, text, images, files, and timestamp
- **Chat State**: Extended with queue-related state (queuedMessages, queue management functions)
- **Persistent Queue**: Messages remain queued across UI updates until processed or manually removed

#### Message Flow
1. **Message Submission**: When `sendingDisabled` is true, messages are added to queue instead of being sent
2. **Queue Processing**: Triggered when `sendingDisabled` becomes false
3. **Sequential Processing**: Messages are processed one at a time to avoid overwhelming the system
4. **State Synchronization**: UI updates reflect queue changes in real-time

#### Key Components

##### useChatState Hook
- Manages queue state (`queuedMessages`)
- Provides queue management functions (`addToQueue`, `clearQueue`, `removeFromQueue`)
- Integrates with existing chat state management

##### useMessageHandlers Hook
- Modified `handleSendMessage` to queue messages when sending is disabled
- Added `processQueue` function for automatic queue processing
- Enhanced with queue-aware logic for task management

##### QueuedMessagesIndicator Component
- Visual representation of queued messages
- Individual message removal capability
- Clear all functionality
- Responsive design matching VS Code theme

##### InputSection Component
- Dynamic placeholder text indicating queuing behavior
- Integrated with existing input handling

## Benefits

### User Experience
- **No interruption**: Users can continue working and planning without waiting for AI to finish
- **Better productivity**: Multiple tasks/questions can be queued in advance
- **Clear feedback**: Visual indicators show what's happening with messages
- **Control**: Users can manage their queue (remove/clear messages)

### Technical
- **Non-blocking UI**: Input remains responsive even when AI is processing
- **State consistency**: Queue state is properly managed and synchronized
- **Error handling**: Graceful handling of edge cases (empty queue, disabled sending)
- **Performance**: Minimal overhead with efficient queue operations

## Usage Examples

### Scenario 1: Multiple Questions
User has several questions while AI is working on a complex task:
1. AI is processing a file editing task
2. User types: "Also, can you explain how this function works?"
3. Message is queued (not lost)
4. User types: "And after that, please optimize the performance"
5. Second message is also queued
6. When AI finishes the file editing, both questions are processed in order

### Scenario 2: Context Addition
User realizes they need to provide additional context:
1. AI is analyzing code
2. User remembers important detail: "Oh, and this code needs to work with legacy browsers"
3. Message is queued
4. When AI completes analysis, the additional context is automatically provided

## Implementation Details

### Queue Data Structure
```typescript
interface QueuedMessage {
    id: string           // Unique identifier
    text: string         // Message text (including processed quotes)
    images: string[]     // Attached images
    files: string[]      // Attached files  
    timestamp: number    // Creation time
}
```

### State Integration
The queue integrates seamlessly with existing chat state:
- Preserves all existing functionality
- Maintains compatibility with images, files, and quotes
- Respects existing sending/button states

### Processing Logic
- FIFO processing ensures message order
- One message processed at a time to prevent system overload
- Automatic retry mechanism when AI becomes available
- Proper cleanup on task completion/cancellation

## Edge Cases Handled

1. **Task Cancellation**: Queue is cleared when starting new tasks
2. **Empty Messages**: Prevents queueing of empty content
3. **Quote Integration**: Active quotes are properly included in queued messages
4. **State Persistence**: Queue survives UI re-renders
5. **Memory Management**: Automatic cleanup prevents memory leaks

## Future Enhancements

Potential improvements to consider:
1. **Priority Queue**: Allow users to prioritize certain messages
2. **Message Editing**: Edit queued messages before they're sent
3. **Queue Persistence**: Save queue across browser sessions
4. **Batch Processing**: Option to send multiple messages as a batch
5. **Smart Queuing**: Automatic message grouping/merging for related content

## Testing

The feature includes comprehensive testing:
- Unit tests for queue operations
- Integration tests for state management
- UI tests for component interactions
- End-to-end tests for complete user flows

Run the test with: `node test-queued-messages.js`