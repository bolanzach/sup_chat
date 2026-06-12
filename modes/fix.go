package modes

import (
	"fmt"
	"os"

	"sup_chat/api"
	"sup_chat/context"
)

const fixSystemPrompt = `You are a terminal assistant. A shell command failed. The user's recent terminal session is included for context, but your job is to diagnose and fix the LAST failed command only.

Rules:
- Focus on the failed command. Use session history only if it helps explain why it failed.
- Be brief. 2-4 sentences max for explanation.
- If the fix is a command, put it on its own line prefixed with "Run: "
- No markdown formatting. Plain text only.
- If you don't know, say so. Don't guess.
- Do not repeat the original command back to the user.`

// Fix diagnoses a failed shell command and streams a suggestion to stdout.
func Fix(cmd, output, cwd string) error {
	client, err := api.NewClient()
	if err != nil {
		return err
	}

	ctx := context.Detect(cwd)
	userMsg := fmt.Sprintf("%s\n\nFailed command: %s\n\nRecent terminal session (including command output):\n%s", ctx, cmd, output)

	color := os.Getenv("NO_COLOR") == ""
	printSeparator(color, true)
	err = client.Stream(fixSystemPrompt, userMsg, os.Stdout)
	fmt.Println()
	printSeparator(color, false)
	return err
}

func printSeparator(color bool, header bool) {
	dim := "\033[2m"
	reset := "\033[0m"
	if !color {
		dim = ""
		reset = ""
	}
	if header {
		fmt.Fprintf(os.Stderr, "%s── sup chat! ──────────────────────────────────%s\n", dim, reset)
	} else {
		fmt.Fprintf(os.Stderr, "%s────────────────────────────────────────%s\n", dim, reset)
	}
}
