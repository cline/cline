package task

// FollowOptions contains options for following a conversation
type FollowOptions struct {
	// SkipActiveTaskCheck skips the check for an active task
	// This is useful when following a task that was just created to avoid race conditions
	SkipActiveTaskCheck bool
}

// DefaultFollowOptions returns the default options for following a conversation
func DefaultFollowOptions() FollowOptions {
	return FollowOptions{
		SkipActiveTaskCheck: false,
	}
}
