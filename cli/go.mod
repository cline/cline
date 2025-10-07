module github.com/cline/cli

go 1.23.0

require (
	github.com/atotto/clipboard v0.1.4
	github.com/cline/grpc-go v0.0.0
	github.com/mattn/go-sqlite3 v1.14.24
	github.com/spf13/cobra v1.8.0
	google.golang.org/grpc v1.75.0
	google.golang.org/protobuf v1.36.6
)

replace github.com/cline/grpc-go => ../src/generated/grpc-go

require (
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.5 // indirect
	golang.org/x/net v0.41.0 // indirect
	golang.org/x/sys v0.33.0 // indirect
	golang.org/x/text v0.26.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20250707201910-8d1bb00bc6a7 // indirect
)
