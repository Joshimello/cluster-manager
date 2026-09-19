package nodecli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"strings"

	"github.com/Joshimello/cluster-manager/node/internal/agent"
	"github.com/Joshimello/cluster-manager/node/internal/config"
	"github.com/Joshimello/cluster-manager/node/internal/lifecycle"
	"github.com/Joshimello/cluster-manager/node/internal/structuredlog"
)

const Usage = `Usage:
  cluster-node setup [--platform-url URL] [--name NAME] [--enrollment-token-file PATH] [--allow-http]
  cluster-node run
  cluster-node status
  cluster-node doctor
  cluster-node re-enroll [--enrollment-token-file PATH]
  cluster-node upgrade [--version vX.Y.Z]
  cluster-node uninstall [--dry-run] [--purge-created-users]
  cluster-node version
  cluster-node --version
`

func Run(ctx context.Context, args []string, version string, in io.Reader, out, errOut io.Writer) error {
	if len(args) == 0 {
		return runAgent(ctx, version, out)
	}
	if args[0] == "--version" || args[0] == "version" {
		if len(args) != 1 {
			return errors.New("version takes no arguments")
		}
		fmt.Fprintf(out, "cluster-node %s\n", version)
		return nil
	}
	manager := lifecycle.New(version, in, out, errOut)
	switch args[0] {
	case "run":
		if len(args) != 1 {
			return errors.New("run takes no arguments")
		}
		return runAgent(ctx, version, out)
	case "setup":
		flags := newFlags("setup", errOut)
		platformURL := flags.String("platform-url", "", "platform URL")
		name := flags.String("name", "", "workstation name")
		tokenFile := flags.String("enrollment-token-file", "", "root-only token file")
		allowHTTP := flags.Bool("allow-http", false, "allow an HTTP platform URL")
		if err := parse(flags, args[1:]); err != nil {
			return err
		}
		return manager.Setup(ctx, lifecycle.SetupOptions{PlatformURL: *platformURL, Name: *name, EnrollmentTokenFile: *tokenFile, AllowHTTP: *allowHTTP})
	case "status":
		if len(args) != 1 {
			return errors.New("status takes no arguments")
		}
		return manager.Status(ctx)
	case "doctor":
		if len(args) != 1 {
			return errors.New("doctor takes no arguments")
		}
		return manager.Doctor(ctx)
	case "re-enroll":
		flags := newFlags("re-enroll", errOut)
		tokenFile := flags.String("enrollment-token-file", "", "root-only token file")
		if err := parse(flags, args[1:]); err != nil {
			return err
		}
		return manager.ReEnroll(ctx, *tokenFile)
	case "upgrade":
		flags := newFlags("upgrade", errOut)
		target := flags.String("version", "", "exact release tag")
		if err := parse(flags, args[1:]); err != nil {
			return err
		}
		return manager.Upgrade(ctx, *target)
	case "uninstall":
		flags := newFlags("uninstall", errOut)
		dryRun := flags.Bool("dry-run", false, "show actions without changing the host")
		purge := flags.Bool("purge-created-users", false, "delete provenance-confirmed users")
		if err := parse(flags, args[1:]); err != nil {
			return err
		}
		return manager.Uninstall(ctx, *dryRun, *purge)
	case "help", "--help", "-h":
		fmt.Fprint(out, Usage)
		return nil
	default:
		return fmt.Errorf("unknown command %q\n%s", args[0], Usage)
	}
}

func newFlags(name string, output io.Writer) *flag.FlagSet {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	flags.SetOutput(output)
	return flags
}

func parse(flags *flag.FlagSet, args []string) error {
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	return nil
}

func runAgent(ctx context.Context, version string, output io.Writer) error {
	logger := log.New(structuredlog.Writer{Destination: output, Component: "node"}, "", 0)
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("configuration error: %w", err)
	}
	runner, err := agent.New(cfg, version, logger)
	if err != nil {
		return fmt.Errorf("startup error: %w", err)
	}
	if err := runner.Run(ctx); err != nil && ctx.Err() == nil {
		return fmt.Errorf("node stopped: %w", err)
	}
	return nil
}
