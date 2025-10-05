package hostbridge

import (
	"log"

	"github.com/cline/grpc-go/host"
)

// WatchService implements the host.WatchServiceServer interface
type WatchService struct {
	host.UnimplementedWatchServiceServer
	coreAddress string
	verbose     bool
}

// NewWatchService creates a new WatchService
func NewWatchService(coreAddress string, verbose bool) *WatchService {
	return &WatchService{
		coreAddress: coreAddress,
		verbose:     verbose,
	}
}

// SubscribeToFile subscribes to file change notifications
func (s *WatchService) SubscribeToFile(req *host.SubscribeToFileRequest, stream host.WatchService_SubscribeToFileServer) error {
	if s.verbose {
		log.Printf("SubscribeToFile called for path: %s", req.GetPath())
	}

	// For console implementation, we'll just log that we would watch the file
	// In a real implementation, we'd use fsnotify or similar to watch file changes
	log.Printf("[Cline] Would watch file: %s", req.GetPath())

	// Keep the stream open but don't send any events for now
	// In a real implementation, we'd send FileChangeEvent messages when files change
	<-stream.Context().Done()

	return nil
}
