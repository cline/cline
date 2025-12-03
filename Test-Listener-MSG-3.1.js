/**
 * Test Listener for MSG-3.1
 * Simulates Cline's behavior: Sends "Task started" then "Task completed"
 */

const fs = require('fs');
const path = require('path');

const QUEUE_DIR = path.join(__dirname, '.message-queue');
const INBOX_DIR = path.join(QUEUE_DIR, 'inbox');
const RESPONSES_DIR = path.join(QUEUE_DIR, 'responses');

function ensureDirectories() {
    [QUEUE_DIR, INBOX_DIR, RESPONSES_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
}

function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function sendResponse(replyTo, content) {
    const response = {
        id: generateId(),
        from: 'cline',
        to: 'powershell-cli',
        timestamp: new Date().toISOString(),
        type: 'response',
        content: content,
        metadata: { replyTo: replyTo }
    };

    // Use current time for filename to ensure uniqueness and ordering
    const filename = `${Date.now()}_${response.id.substring(0, 8)}.json`;
    fs.writeFileSync(path.join(RESPONSES_DIR, filename), JSON.stringify(response, null, 2));
    console.log(`[MockListener] Sent: ${content}`);
}

function processMessage(filename) {
    try {
        const filePath = path.join(INBOX_DIR, filename);
        if (!fs.existsSync(filePath)) return;
        
        const content = fs.readFileSync(filePath, 'utf8');
        const message = JSON.parse(content);

        console.log(`[MockListener] Received: ${message.content}`);

        // 1. Send "Task started" (Ack)
        sendResponse(message.id, `Task started: "${message.content}"`);

        // 2. Wait a bit, then send "Task completed"
        setTimeout(() => {
            sendResponse(message.id, `Task completed: Processed "${message.content}"`);
            
            // Clean up inbox message
            try {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } catch (err) {
                console.error("Error deleting file:", err.message);
            }
        }, 1500);

    } catch (error) {
        console.error("Error processing:", error.message);
    }
}

function main() {
    ensureDirectories();
    console.log("[MockListener] Started watching " + INBOX_DIR);

    // Watch for new files
    let processing = new Set();
    
    fs.watch(INBOX_DIR, (eventType, filename) => {
        if (filename && filename.endsWith('.json') && !processing.has(filename)) {
            processing.add(filename);
            // Small delay to ensure write completion
            setTimeout(() => {
                processMessage(filename);
                processing.delete(filename);
            }, 100);
        }
    });
    
    // Keep alive
    setInterval(() => {}, 1000);
}

main();
