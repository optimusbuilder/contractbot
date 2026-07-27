import OpenAI from "openai";
import { LlmProvider } from "./types.js";
import { resolveApiKey } from "./api-key.js";

export class OpenAIProvider implements LlmProvider {
  private client: OpenAI;
  private model: string;

  constructor(model?: string, baseUrl?: string, apiKeyEnv?: string) {
    const { key } = resolveApiKey({
      apiKeyEnv,
      providerFallbacks: ["OPENAI_API_KEY"],
      providerLabel: "openai (OpenAI-compatible)",
    });
    this.client = new OpenAI({ apiKey: key, baseURL: baseUrl });
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
