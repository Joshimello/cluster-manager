package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/Joshimello/cluster-manager/node/internal/buildinfo"
	"github.com/Joshimello/cluster-manager/node/internal/nodecli"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := nodecli.Run(ctx, os.Args[1:], buildinfo.Version, os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "cluster-node:", err)
		os.Exit(1)
	}
}
