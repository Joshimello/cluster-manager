package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/Joshimello/cluster-manager/node/internal/agent"
	"github.com/Joshimello/cluster-manager/node/internal/buildinfo"
	"github.com/Joshimello/cluster-manager/node/internal/config"
	"github.com/Joshimello/cluster-manager/node/internal/structuredlog"
)

func main() {
	showVersion := flag.Bool("version", false, "print version information")
	flag.Parse()

	if *showVersion {
		fmt.Printf("cluster-manager-node %s\n", buildinfo.Version)
		return
	}

	logger := log.New(structuredlog.Writer{Destination: os.Stdout, Component: "node"}, "", 0)
	cfg, err := config.Load()
	if err != nil {
		logger.Fatalf("configuration error: %v", err)
	}
	runner, err := agent.New(cfg, buildinfo.Version, logger)
	if err != nil {
		logger.Fatalf("startup error: %v", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := runner.Run(ctx); err != nil && ctx.Err() == nil {
		logger.Fatalf("node stopped: %v", err)
	}
}
