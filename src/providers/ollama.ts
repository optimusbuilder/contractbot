import { LlmProvider } from "./types.js";

export class OllamaProvider implements LlmProvider {
  private baseUrl: string;
  private model: string;

  constructor(model?: string, baseUrl?: string) {
    this.baseUrl = baseUrl ?? "http://localhost:11434";
    this.model = model ?? "llama3.1";
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          ...(systemPrompt
            ? [{ role: "system", content: systemPrompt }]
            : []),
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      message?: { content?: string };
    };
    return data.message?.content ?? "";
  }
}
