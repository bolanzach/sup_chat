package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

const (
	apiURL  = "https://api.anthropic.com/v1/messages"
	model   = "claude-sonnet-4-20250514"
	version = "2023-06-01"
)

type Client struct {
	apiKey     string
	httpClient *http.Client
}

func NewClient() (*Client, error) {
	key := os.Getenv("SUP_CHAT_LLM_API_KEY")
	if key == "" {
		return nil, fmt.Errorf("SUP_CHAT_LLM_API_KEY environment variable is not set")
	}
	return &Client{
		apiKey:     key,
		httpClient: &http.Client{},
	}, nil
}

type request struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	Stream    bool      `json:"stream"`
	System    string    `json:"system"`
	Messages  []message `json:"messages"`
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// sseEvent represents a parsed server-sent event.
type sseEvent struct {
	Type string `json:"type"`
	Delta *struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"delta,omitempty"`
}

// Stream sends a message to Claude and streams the response text to w.
func (c *Client) Stream(systemPrompt, userMessage string, w io.Writer) error {
	reqBody := request{
		Model:     model,
		MaxTokens: 1024,
		Stream:    true,
		System:    systemPrompt,
		Messages: []message{
			{Role: "user", Content: userMessage},
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", apiURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", version)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(errBody))
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()

		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var event sseEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue // skip malformed events
		}

		if event.Type == "content_block_delta" && event.Delta != nil && event.Delta.Type == "text_delta" {
			fmt.Fprint(w, event.Delta.Text)
		}

		if event.Type == "message_stop" {
			break
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read stream: %w", err)
	}

	return nil
}