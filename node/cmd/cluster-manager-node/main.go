package main

import (
	"flag"
	"fmt"

	"github.com/Joshimello/cluster-manager/node/internal/buildinfo"
)

func main() {
	showVersion := flag.Bool("version", false, "print version information")
	flag.Parse()

	if *showVersion {
		fmt.Printf("cluster-manager-node %s\n", buildinfo.Version)
		return
	}

	fmt.Println("cluster-manager node skeleton is running")
}
