import Anthropic from "@anthropic-ai/sdk";
import { LlmProvider } from "./types.js";

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;
  private model: string;

  constructor(model?: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for Anthropic provider",
      );
    }
    this.client = new Anthropic({ apiKey });
    this.model = model ?? "claude-sonnet-4-20250514";
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt ?? "",
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content[0];
    return block.type === "text" ? block.text : "";
  }
}
