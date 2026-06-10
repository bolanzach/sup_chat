package context

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Detect inspects the given directory and returns a context string
// describing the project environment, suitable for prepending to LLM prompts.
func Detect(cwd string) string {
	var parts []string

	checks := []struct {
		paths []string
		label string
	}{
		{[]string{"go.mod"}, "Go project"},
		{[]string{"package.json"}, "Node project"},
		{[]string{"Cargo.toml"}, "Rust project"},
		{[]string{"pyproject.toml", "Pipfile", "requirements.txt"}, "Python project"},
		{[]string{"Dockerfile", "docker-compose.yml", "docker-compose.yaml"}, "Docker environment"},
		{[]string{"Makefile"}, "has Makefile"},
	}

	for _, c := range checks {
		for _, p := range c.paths {
			if _, err := os.Stat(cwd + "/" + p); err == nil {
				parts = append(parts, c.label)
				break
			}
		}
	}

	// Git repo
	if _, err := os.Stat(cwd + "/.git"); err == nil {
		label := "git repo"
		cmd := exec.Command("git", "-C", cwd, "remote", "get-url", "origin")
		if out, err := cmd.Output(); err == nil {
			remote := strings.TrimSpace(string(out))
			if remote != "" {
				label = fmt.Sprintf("git repo (remote: %s)", remote)
			}
		}
		parts = append(parts, label)
	}

	env := "Environment: "
	if len(parts) > 0 {
		env += strings.Join(parts, ", ")
	} else {
		env += "unknown project type"
	}

	return fmt.Sprintf("%s\nOS: %s/%s\nShell: zsh\nCWD: %s",
		env, runtime.GOOS, runtime.GOARCH, cwd)
}
