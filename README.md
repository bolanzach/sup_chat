# SUP CHAT!

There's two distinct parts, maybe they'll come together, maybe not.

## Sup Chat

This is what is actually useful today. Adds a `zsh` hook that intercepts your terminal commands, giving you superpowers! AI will correct any mistakes you make and give suggestions, or ask the AI in natural language for creating a shell command.

### Examples

```shell
> npams   
zsh: command not found: npams
── sup chat! ──────────────────────────────────                                                                                                                   
The command "npams" is not recognized. This appears to be a typo.

You likely meant one of these common commands:
- "npm" for Node.js package management
- "npx" to execute Node.js packages
- "nmap" for network scanning

Run: npm --help

Or if you meant to run a specific npm command, try "npm install", "npm start", or "npm run [script-name]".
────────────────────────────────────────
```

Or ask the AI to generate a co,mand for you. Prefix your query with `??`:

```shell
> ?? what is in the current dir
ls -la
```

### Setup

Add the sup_chat binary to your PATH, and add the following to your `.zshrc`:

```shell
export SUP_CHAT_LLM_API_KEY="sk-ant-..." # claude API key
source /path/to/sup_chat/zsh/sup_chat.zsh
```

## Sup Chat Harness

A custom AI harness for agentic workflows aimed at local LLMs using ollama. It's a work in progress.