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
)

func main() {
	showVersion := flag.Bool("version", false, "print version information")
	flag.Parse()

	if *showVersion {
		fmt.Printf("cluster-manager-node %s\n", buildinfo.Version)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("configuration error: %v", err)
	}
	logger := log.New(os.Stdout, "cluster-manager-node: ", log.LstdFlags|log.LUTC)
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
