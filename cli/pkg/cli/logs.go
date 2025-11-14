package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/global"
	"github.com/spf13/cobra"
)

type logFileInfo struct {
	name    string
	path    string
	size    int64
	created time.Time
}

func NewLogsCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "logs",
		Aliases: []string{"log", "l"},
		Short:   "Manage Cline log files",
		Long:    `List and manage log files created by Cline instances.`,
	}

	cmd.AddCommand(newLogsListCommand())
	cmd.AddCommand(newLogsCleanCommand())
	cmd.AddCommand(newLogsPathCommand())

	return cmd
}

func newLogsListCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "list",
		Aliases: []string{"l", "ls"},
		Short:   "List all log files",
		Long:    `List all log files in the Cline logs directory with their sizes and ages.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if global.Config == nil {
				return fmt.Errorf("config not initialized")
			}

			logsDir := filepath.Join(global.Config.ConfigPath, "logs")
			logs, err := listLogFiles(logsDir)
			if err != nil {
				return fmt.Errorf("failed to list log files: %w", err)
			}

			if len(logs) == 0 {
				fmt.Println("No log files found.")
				fmt.Printf("Log files will be created in: %s\n", logsDir)
				return nil
			}

			return renderLogsTable(logs, false)
		},
	}

	return cmd
}

func newLogsCleanCommand() *cobra.Command {
	var olderThan int
	var all bool
	var dryRun bool

	cmd := &cobra.Command{
		Use:     "clean",
		Aliases: []string{"c"},
		Short:   "Delete old log files",
		Long:    `Delete log files older than a specified number of days.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if global.Config == nil {
				return fmt.Errorf("config not initialized")
			}

			logsDir := filepath.Join(global.Config.ConfigPath, "logs")
			logs, err := listLogFiles(logsDir)
			if err != nil {
				return fmt.Errorf("failed to list log files: %w", err)
			}

			var toDelete []logFileInfo
			if all {
				toDelete = logs
			} else {
				toDelete = filterOldLogs(logs, olderThan)
			}

			if len(toDelete) == 0 {
				if all {
					fmt.Println("No log files to delete.")
				} else {
					fmt.Printf("No log files older than %d days found.\n", olderThan)
				}
				return nil
			}

			// Calculate total size
			var totalSize int64
			for _, log := range toDelete {
				totalSize += log.size
			}

			if dryRun {
				fmt.Println("The following log files will be deleted:\n")
				if err := renderLogsTable(toDelete, true); err != nil {
					return err
				}
				fileWord := "files"
				if len(toDelete) == 1 {
					fileWord = "file"
				}
				fmt.Printf("\nSummary: %d %s will be deleted (%s freed)\n", len(toDelete), fileWord, formatFileSize(totalSize))
				fmt.Println("\nRun without --dry-run to actually delete these files.")
				return nil
			}

			// Actually delete the files
			count, bytesFreed, err := deleteLogFiles(toDelete)
			if err != nil {
				return fmt.Errorf("failed to delete log files: %w", err)
			}

			fileWord := "files"
			if count == 1 {
				fileWord = "file"
			}
			fmt.Printf("Deleted %d log %s (%s freed)\n", count, fileWord, formatFileSize(bytesFreed))
			return nil
		},
	}

	cmd.Flags().IntVar(&olderThan, "older-than", 7, "delete logs older than N days")
	cmd.Flags().BoolVar(&all, "all", false, "delete all log files")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "show what would be deleted without deleting")

	return cmd
}

func newLogsPathCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "path",
		Short: "Print the logs directory path",
		Long:  `Print the absolute path to the Cline logs directory.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if global.Config == nil {
				return fmt.Errorf("config not initialized")
			}

			logsDir := filepath.Join(global.Config.ConfigPath, "logs")
			fmt.Println(logsDir)
			return nil
		},
	}

	return cmd
}

// Helper functions

func listLogFiles(logsDir string) ([]logFileInfo, error) {
	// Check if logs directory exists
	if _, err := os.Stat(logsDir); os.IsNotExist(err) {
		return []logFileInfo{}, nil
	}

	entries, err := os.ReadDir(logsDir)
	if err != nil {
		return nil, err
	}

	var logs []logFileInfo
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		// Only process .log files
		if !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}

		// Parse timestamp from filename
		created, err := parseTimestampFromFilename(entry.Name())
		if err != nil {
			// Skip files we can't parse
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		logs = append(logs, logFileInfo{
			name:    entry.Name(),
			path:    filepath.Join(logsDir, entry.Name()),
			size:    info.Size(),
			created: created,
		})
	}

	// Sort by created time (oldest first)
	sort.Slice(logs, func(i, j int) bool {
		return logs[i].created.Before(logs[j].created)
	})

	return logs, nil
}

func parseTimestampFromFilename(filename string) (time.Time, error) {
	// Expected format: cline-core-2025-10-12-21-30-45-localhost-51051.log
	// or: cline-host-2025-10-12-21-30-45-localhost-52051.log

	parts := strings.Split(filename, "-")
	if len(parts) < 8 {
		return time.Time{}, fmt.Errorf("invalid filename format")
	}

	// Extract timestamp parts: YYYY-MM-DD-HH-mm-ss
	// They should be at indices 2-7
	timestampStr := strings.Join(parts[2:8], "-")

	// Parse as local time since the filename timestamp is created in local time
	parsedTime, err := time.ParseInLocation("2006-01-02-15-04-05", timestampStr, time.Local)
	if err != nil {
		return time.Time{}, err
	}

	return parsedTime, nil
}

func filterOldLogs(logs []logFileInfo, olderThanDays int) []logFileInfo {
	cutoff := time.Now().AddDate(0, 0, -olderThanDays)
	var filtered []logFileInfo

	for _, log := range logs {
		if log.created.Before(cutoff) {
			filtered = append(filtered, log)
		}
	}

	return filtered
}

func deleteLogFiles(files []logFileInfo) (int, int64, error) {
	var count int
	var bytesFreed int64

	for _, file := range files {
		if err := os.Remove(file.path); err != nil {
			return count, bytesFreed, err
		}
		count++
		bytesFreed += file.size
	}

	return count, bytesFreed, nil
}

func formatFileSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

func formatAge(t time.Time) string {
	duration := time.Since(t)

	if duration < time.Hour {
		minutes := int(duration.Minutes())
		return fmt.Sprintf("%dm ago", minutes)
	}

	if duration < 24*time.Hour {
		hours := int(duration.Hours())
		return fmt.Sprintf("%dh ago", hours)
	}

	if duration < 7*24*time.Hour {
		days := int(duration.Hours() / 24)
		return fmt.Sprintf("%dd ago", days)
	}

	weeks := int(duration.Hours() / 24 / 7)
	return fmt.Sprintf("%dw ago", weeks)
}

func renderLogsTable(logs []logFileInfo, markForDeletion bool) error {
	// Build table data
	type tableRow struct {
		filename string
		size     string
		created  string
		age      string
	}

	var rows []tableRow
	for _, log := range logs {
		rows = append(rows, tableRow{
			filename: log.name,
			size:     formatFileSize(log.size),
			created:  log.created.Format("2006-01-02 15:04:05"),
			age:      formatAge(log.created),
		})
	}

	// Check output format
	if global.Config.OutputFormat == "plain" {
		// Use tabwriter for plain output
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "FILENAME\tSIZE\tCREATED\tAGE")

		for _, row := range rows {
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\n",
				row.filename,
				row.size,
				row.created,
				row.age,
			)
		}

		w.Flush()
		return nil
	}

	// Use markdown table for rich output
	colorRenderer := display.NewRenderer(global.Config.OutputFormat)
	var markdown strings.Builder
	markdown.WriteString("| **FILENAME** | **SIZE** | **CREATED** | **AGE** |\n")
	markdown.WriteString("|--------------|----------|-------------|---------|")

	for _, row := range rows {
		line := fmt.Sprintf("\n| %s | %s | %s | %s |",
			row.filename,
			row.size,
			row.created,
			row.age,
		)

		// If marking for deletion, wrap in red
		if markForDeletion {
			line = colorRenderer.Red(line)
		}

		markdown.WriteString(line)
	}

	// Render the markdown table
	renderer, err := display.NewMarkdownRendererForTerminal()
	if err != nil {
		// Fallback to plain markdown if renderer fails
		fmt.Println(markdown.String())
		return nil
	}

	rendered, err := renderer.Render(markdown.String())
	if err != nil {
		fmt.Println(markdown.String())
		return nil
	}

	fmt.Print(strings.TrimLeft(rendered, "\n"))
	fmt.Println()

	return nil
}