package main

import (
	"flag"
	"fmt"
	"os"

	"sup_chat/modes"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "fix":
		fixCmd := flag.NewFlagSet("fix", flag.ExitOnError)
		cmd := fixCmd.String("cmd", "", "the command that failed")
		output := fixCmd.String("output", "", "stdout/stderr from the failed command")
		cwd := fixCmd.String("cwd", ".", "working directory")
		fixCmd.Parse(os.Args[2:])

		if *cmd == "" {
			fmt.Fprintln(os.Stderr, "error: --cmd is required")
			os.Exit(1)
		}
		if err := modes.Fix(*cmd, *output, *cwd); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}

	case "nl":
		nlCmd := flag.NewFlagSet("nl", flag.ExitOnError)
		query := nlCmd.String("query", "", "natural language query")
		cwd := nlCmd.String("cwd", ".", "working directory")
		nlCmd.Parse(os.Args[2:])

		if *query == "" {
			fmt.Fprintln(os.Stderr, "error: --query is required")
			os.Exit(1)
		}
		if err := modes.NL(*query, *cwd); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}

	default:
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `Usage: sup_chat <command> [flags]

Commands:
  fix   Diagnose a failed shell command
  nl    Translate natural language to a shell command

Fix flags:
  --cmd       The command that failed (required)
  --output    Captured stdout/stderr from the command
  --cwd       Working directory (default: .)

NL flags:
  --query     Natural language query (required)
  --cwd       Working directory (default: .)`)
}
