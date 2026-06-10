package modes

import (
	"fmt"
	"os"

	"sup_chat/api"
	"sup_chat/context"
)

const nlSystemPrompt = `You are a shell command translator. Convert natural language to a single shell command.

Rules:
- Output ONLY the shell command. Nothing else. No explanation, no markdown, no backticks.
- If the request is ambiguous, output the most likely command.
- Assume zsh on macOS unless context says otherwise.`

// NL translates a natural language query into a shell command and prints it.
func NL(query, cwd string) error {
	client, err := api.NewClient()
	if err != nil {
		return err
	}

	ctx := context.Detect(cwd)
	userMsg := fmt.Sprintf("%s\n\nTranslate to shell command: %s", ctx, query)

	err = client.Stream(nlSystemPrompt, userMsg, os.Stdout)
	fmt.Println()
	return err
}