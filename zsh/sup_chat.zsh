#!/usr/bin/env zsh
# sup_chat zsh plugin — AI error assistance + natural language commands
# Source this file from ~/.zshrc:
#   source /path/to/zsh/sup_chat.zsh

# Global kill switch
[[ -n "$SUP_CHAT_DISABLED" ]] && return

# --- Script session for output capture ---
if [[ -z "$SUP_CHAT_SCRIPT_SESSION" ]]; then
  export SUP_CHAT_SCRIPT_SESSION=1
  export SUP_CHAT_LOG="/tmp/sup_chat-$$.log"
  exec script -q -F "$SUP_CHAT_LOG"
fi

# --- State ---
typeset -g SUP_CHAT_LAST_CMD=""
typeset -g SUP_CHAT_CMD_START_LINE=0
typeset -g SUP_CHAT_SKIP=0

# --- preexec: runs before each command ---
_sup_chat_preexec() {
  local cmd="$1"

  # Opt-out: noai prefix
  if [[ "$cmd" == noai\ * ]]; then
    SUP_CHAT_SKIP=1
    return
  fi

  # Natural language: ?? prefix
  if [[ "$cmd" == \?\?\ * ]]; then
    local query="${cmd#\?\? }"
    sup_chat nl --query "$query" --cwd "$PWD"
    kill -INT $$
    return
  fi

  SUP_CHAT_SKIP=0
  SUP_CHAT_LAST_CMD="$cmd"
  SUP_CHAT_CMD_START_LINE=$(wc -l < "$SUP_CHAT_LOG" 2>/dev/null || echo 0)
}

# --- precmd: runs before each prompt ---
_sup_chat_precmd() {
  local exit_code=$?

  # Nothing to do on success, empty cmd, or opt-out
  [[ $exit_code -eq 0 ]] && return
  [[ -z "$SUP_CHAT_LAST_CMD" ]] && return
  [[ $SUP_CHAT_SKIP -eq 1 ]] && return

  # Extract output since command started
  local output=""
  if [[ -f "$SUP_CHAT_LOG" ]]; then
    output=$(tail -n +"$SUP_CHAT_CMD_START_LINE" "$SUP_CHAT_LOG" 2>/dev/null | \
             col -b 2>/dev/null | \
             head -c 4000)
  fi

  sup_chat fix \
    --cmd "$SUP_CHAT_LAST_CMD" \
    --output "$output" \
    --cwd "$PWD"

  SUP_CHAT_LAST_CMD=""
}

# --- Register hooks ---
autoload -Uz add-zsh-hook
add-zsh-hook preexec _sup_chat_preexec
add-zsh-hook precmd _sup_chat_precmd