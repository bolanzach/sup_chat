import { extract } from "jsr:@std/front-matter/yaml";

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
      description: "Creates a new empty directory on the local filesystem. Prefer this over bash mkdir.",
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
      description: "Lists all files and directories in the path. Prefer this over bash ls.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path of the directory to list." },
        },
      },
    },
    handler: async (input: unknown) => {
      const { path } = input as { path?: string };
      const directoryPath = !path || path.trim() === "" ? "." : path;
      const entries: string[] = [];
      for await (const entry of Deno.readDir(directoryPath)) {
        if (entry.isFile || entry.isDirectory) {
          entries.push(entry.isDirectory ? `${entry.name}/` : entry.name);
        }
      }
      return { status: "success", content: `Files in ${directoryPath}: ${entries.join(", ")}` };
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
      name: "ask_user",
      description: "Pause and ask the user a question. Use sparingly — only for info you cannot determine yourself, or to confirm destructive operations.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to ask the user." },
        },
      },
    },
    handler: (input: unknown) => {
      const { question } = input as { question: string };
      console.log(`\n${question}`);
      const answer = prompt("> ") ?? "";
      return Promise.resolve({ status: "success", content: answer });
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
          agentType: { type: "string", description: "Which agent to spawn.", enum: ["PLAN", "EXTRACT_EXTERNAL_RESOURCES", "GIT_COMMIT"] },
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

type Agent = { name: string; description: string; body: string };

async function loadAgent(name: string): Promise<Agent> {
  const content = await Deno.readTextFile(`./agents/${name}.md`);
  const { attrs, body } = extract<{ name: string; description: string }>(content);
  return { name: attrs.name, description: attrs.description, body: body.trim() };
}

const PLAN_AGENT = await loadAgent("plan");
const EXTRACT_AGENT = await loadAgent("extract_external_resources");
const GIT_AGENT = await loadAgent("git_commit");

const AGENTS = {
  PLAN: {
    description: PLAN_AGENT.description,
    agent: function (prompt: string) {
      const agentProvider = new OllamaProvider("gemma4-agent");
      return agent(agentProvider, this.tools, [{ role: "system", content: PLAN_AGENT.body }], prompt);
    },
    tools: REGISTERED_TOOLS,
  },
  EXTRACT_EXTERNAL_RESOURCES: {
    description: EXTRACT_AGENT.description,
    agent: function (prompt: string) {
      const agentProvider = new OllamaProvider("gemma4-agent");
      return agent(agentProvider, this.tools, [{ role: "system", content: EXTRACT_AGENT.body }], prompt);
    },
    tools: REGISTERED_TOOLS.filter((t) => ["list_files", "read_file", "ask_user"].includes(t.function.name)),
  },
  GIT_COMMIT: {
    description: GIT_AGENT.description,
    agent: function (prompt: string) {
      const agentProvider = new OllamaProvider("gemma4-agent");
      return agent(agentProvider, this.tools, [{ role: "system", content: GIT_AGENT.body }], prompt);
    },
    tools: REGISTERED_TOOLS.filter((t) => ["bash", "read_file", "list_files", "ask_user"].includes(t.function.name)),
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

  const currentDirContents: string[] = []
  for await (const entry of Deno.readDir(".")) {
    if (entry.isFile || entry.isDirectory) {
      currentDirContents.push(entry.isDirectory ? `${entry.name}/` : entry.name);
    }
  }

  let messages: Message[] = [{
    role: "system",
    content:
      `You are a highly skilled and knowledgeable principal software engineer whose goal is to assist the user with their work.
The current date is ${new Date().toLocaleDateString()}. Operating system details: ${JSON.stringify(Deno.build)}. The current working directory is: ${Deno.cwd()} and its contents is: ${currentDirContents.join(", ")}
You can not do anything that would cause harm to the user's system or data. Always ask before executing a command that could be destructive.
Think carefully step by step. If you don't know the answer to a question, say you don't know instead of making something up.
Before responding you must consider using the **spawn_agent** tool to create specialized agent(s) that will help you respond to the user. When you spawn a sub-agent, delegate the full task. Do not ask the sub-agent for advice you intend to act on yourself. Use multiple agents if necessary. The available agents are:
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

The user may have accidentally tried to prompt instead of executing a command. We must help by doing one of the following:
1. If the input was likely a command but had an error (spelling, wrong params, permissions, etc), help the user fix the command so it works.
2. Otherwise we can assume the command is using natural language and is actually a prompt for an AI agent rather than a shell command. You must answer the prompt instead and ignore the error.`);
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
