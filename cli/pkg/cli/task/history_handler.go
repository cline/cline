package task

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/cline/cli/pkg/cli/types"
	"github.com/cline/grpc-go/cline"
)

// ListTasksFromDisk reads task history directly from disk
func ListTasksFromDisk() error {
	// Get the task history file path
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}

	filePath := filepath.Join(homeDir, ".cline", "data", "state", "taskHistory.json")

	// Read the file
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Println("No task history found.")
			return nil
		}
		return fmt.Errorf("failed to read task history: %w", err)
	}

	// Parse JSON into intermediate struct
	var historyItems []types.HistoryItem
	if err := json.Unmarshal(data, &historyItems); err != nil {
		return fmt.Errorf("failed to parse task history: %w", err)
	}

	if len(historyItems) == 0 {
		fmt.Println("No task history found.")
		return nil
	}

	// Sort by timestamp ascending (oldest first, newest last)
	sort.Slice(historyItems, func(i, j int) bool {
		return historyItems[i].Ts < historyItems[j].Ts
	})

	// Convert to protobuf TaskItem format for rendering
	tasks := make([]*cline.TaskItem, len(historyItems))
	for i, item := range historyItems {
		tasks[i] = &cline.TaskItem{
			Id:          item.Id,
			Task:        item.Task,
			Ts:          item.Ts,
			IsFavorited: item.IsFavorited,
			Size:        item.Size,
			TotalCost:   item.TotalCost,
			TokensIn:    item.TokensIn,
			TokensOut:   item.TokensOut,
			CacheWrites: item.CacheWrites,
			CacheReads:  item.CacheReads,
		}
	}

	// Use existing renderer
	renderer := display.NewRenderer(global.Config.OutputFormat)
	return renderer.RenderTaskList(tasks)
}
