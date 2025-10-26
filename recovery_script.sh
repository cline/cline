#!/bin/bash
# recovery_script.sh

DB_PATH="/Users/szymon/Library/Application Support/VSCodium/User/globalStorage/state.vscdb"
TASKS_PATH="/Users/szymon/Library/Application Support/VSCodium/User/globalStorage/saoudrizwan.claude-dev/tasks"

# 1. Extract current JSON from DB
echo "SELECT value FROM ItemTable WHERE key = 'saoudrizwan.claude-dev';" | sqlite3 "$DB_PATH" > /tmp/current_state.json

# Check if current_state.json is empty or invalid
if [ ! -s /tmp/current_state.json ]; then
    echo "Error: /tmp/current_state.json is empty or invalid. Exiting."
    exit 1
fi

# 2. Build recovery items as a JSON array
echo "[]" > /tmp/recovery_items.json

# Read missing task IDs from the file created by recovery_prep.sh
# Ensure /tmp/missing_tasks.txt exists and is populated
if [ ! -s /tmp/missing_tasks.txt ]; then
    echo "Error: /tmp/missing_tasks.txt not found or empty. Please run recovery_prep.sh first."
    exit 1
fi

while IFS= read -r task_id; do
    ui_messages_file="$TASKS_PATH/$task_id/ui_messages.json"
    
    if [ -f "$ui_messages_file" ]; then
        echo "Processing task: $task_id"
        
        # Extract initial task description from ui_messages.json
        # The first message of type "say" and "text" usually contains the initial prompt
        task_description=$(jq -r '.[0] | select(.type == "say" and .say == "text") | .text' "$ui_messages_file")
        
        # Get timestamp from the first message in ui_messages.json
        # This is more reliable than file system timestamp for the task's start time
        task_timestamp=$(jq -r '.[0] | .ts' "$ui_messages_file")

        # Fallback for timestamp if not found in ui_messages.json
        if [ -z "$task_timestamp" ]; then
            # Get creation timestamp of the directory as a fallback
            # macOS specific: stat -f %B for birth time (creation time)
            task_timestamp=$(stat -f %B "$TASKS_PATH/$task_id"000) # Convert to milliseconds
            echo "Warning: Timestamp not found in ui_messages.json for $task_id, using directory creation time."
        fi

        # Construct HistoryItem JSON. Using explicit checks for null/empty values for robustness.
        # Ensure proper JSON escaping for task_description
        task_item_json=$(jq -n \
            --arg id "$task_id" \
            --arg task_desc "$task_description" \
            --argjson ts "${task_timestamp:-0}" \
            '{
                id: $id,
                ts: $ts,
                task: $task_desc,
                tokensIn: 0,
                tokensOut: 0,
                cacheWrites: 0,
                cacheReads: 0,
                totalCost: 0,
                size: 0,
                cwdOnTaskInitialization: null,
                isFavorited: false,
                ulid: null
            }')
        
        # Append the constructed HistoryItem to the recovery_items.json array
        jq ". += [ $task_item_json ]" /tmp/recovery_items.json > /tmp/recovery_items_tmp.json
        mv /tmp/recovery_items_tmp.json /tmp/recovery_items.json
    else
        echo "Warning: ui_messages.json not found for task $task_id. Skipping."
    fi
done < /tmp/missing_tasks.txt

# 3. Merge recovered items with existing taskHistory in the main state JSON
# Read the current state JSON into jq, then read the recovery items JSON into jq as another input
jq --slurpfile recovered /tmp/recovery_items.json \
   '.taskHistory += $recovered[]' /tmp/current_state.json > /tmp/updated_state.json

# 4. Verify the result
echo "Original task count: $(jq '.taskHistory | length' /tmp/current_state.json)"
echo "Recovery items count: $(jq '. | length' /tmp/recovery_items.json)"
echo "Final task count: $(jq '.taskHistory | length' /tmp/updated_state.json)"

# 5. Update database (uncomment when ready)
# IMPORTANT: Ensure VSCode is completely closed before running this step to avoid data corruption.
# sqlite3 "$DB_PATH" "UPDATE ItemTable SET value = '$(cat /tmp/updated_state.json)' WHERE key = 'saoudrizwan.claude-dev';"
