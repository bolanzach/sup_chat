type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown> };
  };
};

type RegisteredTool = ToolDefinition & {
  handler: (input: unknown) => Promise<{ status: "success" | "error"; content: string }>;
};

interface Provider {
  chat(messages: Message[], tools: ToolDefinition[]): Promise<Message & { role: "assistant" }>;
}

const REGISTERED_TOOLS: RegisteredTool[] = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Writes a file to the local filesystem.",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "The name of the file to write." },
          content: { type: "string", description: "The content of the file to write." },
        },
      },
    },
    handler: async (input: unknown) => {
      const { fileName, content } = input as { fileName: string; content: string };
      await Deno.writeTextFile(`./${fileName}`, content);
      return { status: "success", content: `Wrote ${fileName}` };
    },
  },
  {
    type: "function",
    function: {
      name: "make_directory",
      description: "Creates a new empty directory on the local filesystem.",
      parameters: {
        type: "object",
        properties: {
          directoryName: { type: "string", description: "The name of the directory to make." },
        },
      },
    },
    handler: async (input: unknown) => {
      const { directoryName } = input as { directoryName: string };
      await Deno.mkdir(directoryName);
      return { status: "success", content: `Created new directory ${directoryName}` };
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "Lists all files and directories in the path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path of the directory to list." },
        },
      },
    },
    handler: async (input: unknown) => {
      const { path } = input as { path: string };
      const directoryPath = `./${path ?? ""}`;
      const files: string[] = [];
      for await (const entry of Deno.readDir(directoryPath)) {
        if (entry.isFile || entry.isDirectory) {
          files.push(entry.name);
        }
      }
      return { status: "success", content: `Files in ${directoryPath}: ${files.join(", ")}` };
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Reads a file from the local filesystem.",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "The name of the file to read" },
        },
      },
    },
    handler: async (input: unknown) => {
      const { fileName } = input as { fileName: string };
      const content = await Deno.readTextFile(`./${fileName}`);
      return { status: "success", content };
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: "Executes a shell command string via bash -c. Supports pipes, &&, redirects, etc.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The full shell command to execute." },
        },
      },
    },
    handler: async (input: unknown) => {
      const { command } = input as { command: string };
      const process = new Deno.Command("bash", {
        args: ["-c", command],
        stdout: "piped",
        stderr: "piped",
      });

      const { code, stdout, stderr } = await process.output();
      const output = new TextDecoder().decode(stdout);
      const error = new TextDecoder().decode(stderr);

      if (code === 0) {
        return { status: "success", content: output || "(no output)" };
      } else {
        return { status: "error", content: error || `Command failed with exit code ${code}` };
      }
    },
  },
  {
    type: "function",
    function: {
      name: "spawn_agent",
      description: "Spawns a new LLM agent of a certain type with the given prompt. The agent's job is to perform a specialized sub-task that will help complete the current task at hand.",
      parameters: {
        type: "object",
        properties: {
          agentType: { type: "string", description: "Which agent to spawn.", enum: ["PLAN", "EXTRACT_EXTERNAL_RESOURCES"] },
          prompt: { type: "string", description: "The instructions to send to the agent." },
        },
      },
    },
    handler: async (input: unknown) => {
      const { agentType, prompt } = input as { agentType: string, prompt: string };

      const agentDef = AGENTS[agentType as keyof typeof AGENTS];
      if (!agentDef) {
        return { status: "error", content: `Agent type ${agentType} is not defined` };
      }

      const agent = agentDef.agent.bind({ tools: agentDef.tools });
      try {
        const resultMessages = await agent(prompt);
        const last = [...resultMessages].reverse().find(
          (m): m is Message & { role: "assistant" } => m.role === "assistant" && !!m.content,
        );
        return { status: "success", content: last?.content ?? `Agent ${agentType} completed (no output)` };
      } catch (error) {
        return { status: "error", content: `Agent ${agentType} failed with error: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  },
];

const AGENTS = {
  PLAN: {
    description: "Use this agent to create and execute plans. It should be used when the user asks for help with a complex task and you need to create a plan to complete the task.",
    agent: function (prompt: string) {
      const agentProvider = new OllamaProvider("gemma4-agent");
      const systemPrompt = `You are a helpful and precise assistant for helping the user complete their task. You create detailed plans for how to complete the user's task and then execute those plans step by step, checking for success at each step. If a step fails, you stop and report the error instead of moving on to the next step. Always think step by step.`
      return agent(agentProvider, this.tools, [{ role: "system", content: systemPrompt }], prompt);
    },
    tools: REGISTERED_TOOLS,
  },
  EXTRACT_EXTERNAL_RESOURCES: {
    description: "Use this agent to pull out relevant files mentioned in the user's prompt that can be used for context in another agent.",
    agent: function (prompt: string) {
      const agentProvider = new OllamaProvider("gemma4-agent");
      const systemPrompt = `Your only job is to gather file context for another agent. You must call tools — never reply with text alone.

Procedure:
1. If the user names a file path, call read_file on it directly.
2. If they mention something vague (e.g. "the auth code", "the agent"), call list_files first to find candidates, then read_file on the most likely match.
3. When done gathering, output the file contents wrapped as: <file path="X">...contents...</file>. One block per file. If nothing applies, output exactly: NONE.

Do not summarize. Do not explain. Do not ask questions. Output only file blocks or NONE.`;
      return agent(agentProvider, this.tools, [{ role: "system", content: systemPrompt }], prompt);
    },
    tools: REGISTERED_TOOLS.filter((t) => ["list_files", "read_file"].includes(t.function.name)),
  },
}

class OllamaProvider implements Provider {
  constructor(
    private model: string = "gemma4-agent",
    private baseUrl: string = "http://localhost:11434",
  ) {}

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<Message & { role: "assistant" }> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    const msg = json.choices[0].message;

    return {
      role: "assistant",
      content: msg.content ?? "",
      ...(msg.tool_calls?.length && { tool_calls: msg.tool_calls }),
    };
  }
}

async function agent(provider: Provider, tools: RegisteredTool[], existingMessages: Message[], ...userMessages: string[]): Promise<Message[]> {
  const messages: Message[] = [
    ...existingMessages,
    ...userMessages.map((content): Message => ({ role: "user", content })),
  ];

  while (true) {
    const reply = await provider.chat(messages, tools);
    messages.push(reply);

    if (!reply.tool_calls?.length) {
      if (reply.content)
        console.log(reply.content);
      return messages;
    }

    for (const toolCall of reply.tool_calls) {
      console.log(`[tool_use] ${toolCall.function.name}`, toolCall.function.arguments);
      const input = JSON.parse(toolCall.function.arguments);
      const tool = tools.find((t) => t.function.name === toolCall.function.name);
      let result: { status: "success" | "error"; content: string };

      if (!tool) {
        result = { status: "error", content: `Tool ${toolCall.function.name} is not found` };
      } else {
        try {
          result = await tool.handler(input);
        } catch (error) {
          result = {
            status: "error",
            content: `Error executing tool ${toolCall.function.name}: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (result.status === "error") {
        console.error(`[tool_error] ${toolCall.function.name}: ${result.content}`);
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.status === "success" ? result.content : `Error: ${result.content}`,
      });
    }
  }
}

async function cli() {
  let mode: '?' | '>' = '>';
  const provider = new OllamaProvider("gemma4-agent");
  let messages: Message[] = [{
    role: "system",
    content:
      `You are a highly skilled and knowledgeable principal software engineer whose goal is to assist the user with their work.
The current date is ${new Date().toLocaleDateString()}. The current working directory is: ${Deno.cwd()}
You can not do anything that would cause harm to the user's system or data. Always ask before executing a command that could be destructive.
Think carefully step by step. If you don't know the answer to a question, say you don't know instead of making something up.
Before responding you must consider using the **spawn_agent** tool to create specialized agent(s) that will help you respond to the user. Use multiple agents if necessary. The available agents are:
        ${Object.entries(AGENTS).map(([agentType, { description }]) => `  - ${agentType}: ${description}`).join("\n")}
      `
  }];

  while (true) {
    const input = prompt(`${mode} `);
    if (input === null || input.trim() === "exit") break;
    let command = input;

    if (input.startsWith("?")) {
      mode = "?";
      command = input.substring(2);
    } else if (input.startsWith(">")) {
      mode = ">";
      command = input.substring(2);
    }

    if (command.trim().length === 0) {
      continue;
    }

    if (mode === '?') {
      messages = await agent(provider, REGISTERED_TOOLS, messages, command);
    } else {
      try {
        const process = new Deno.Command("bash", {
          args: ["-c", command],
          stdout: "inherit",
          stderr: "piped",
        });

        const { code, stderr } = await process.output();
        const error = new TextDecoder().decode(stderr);
        if (code !== 0) {
          messages = await agent(provider, REGISTERED_TOOLS, messages, `The user entered the following command into the shell: ${command}
          
The error message was: ${error instanceof Error ? error.message : String(error)}

We can do one of the following:
1. Help the user fix the command so it works.
2. If the command was supposed to be a prompt for an AI agent rather than a shell command, answer the prompt instead and ignore the error.`);
        }
      } catch (error) {
        console.error(`${error instanceof Error ? error.message : String(error)}`);
      }

    }

  }
}

if (import.meta.main) {
  try {
    await cli();
    Deno.exit(0);
  } catch (_error) {
    Deno.exit(1);
  }
}
