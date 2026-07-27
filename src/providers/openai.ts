import OpenAI from "openai";
import { LlmProvider } from "./types.js";

export class OpenAIProvider implements LlmProvider {
  private client: OpenAI;
  private model: string;

  constructor(model?: string, baseUrl?: string) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required for OpenAI provider",
      );
    }
    this.client = new OpenAI({ apiKey, baseURL: baseUrl });
    this.model = model ?? "gpt-4o-mini";
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: 0.1,
    });

    return response.choices[0]?.message?.content ?? "";
  }
}
