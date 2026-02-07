import * as vscode from "vscode";
import { AIProvider, AIOptions, AIModelInfo } from "../types";
import { buildCommitSystemPrompt, truncateDiffForAI } from "../prompt";

export class CopilotProvider implements AIProvider {
  id = "copilot";
  name = "GitHub Copilot";

  async isAvailable(): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      return models.length > 0;
    } catch {
      return false;
    }
  }

  async generateCommitMessage(diff: string, options: AIOptions): Promise<string> {
    const models = await vscode.lm.selectChatModels({
      vendor: "copilot",
      family: options.model || undefined,
    });

    if (models.length === 0) {
      throw new Error(
        "GitHub Copilot is not available. Please install and sign in to the Copilot extension."
      );
    }

    const model = models[0];

    const truncatedDiff = truncateDiffForAI(diff, options);
    const systemPrompt = buildCommitSystemPrompt(options);

    const messages = [
      vscode.LanguageModelChatMessage.User(
        `${systemPrompt}\n\nGenerate a commit message for the following git diff:\n\n${truncatedDiff}`
      ),
    ];

    const response = await model.sendRequest(messages, {});

    let result = "";
    for await (const chunk of response.text) {
      result += chunk;
    }

    return result.trim();
  }

  async listModels(): Promise<AIModelInfo[]> {
    try {
      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      const mapped = models
        .map((model) => ({ id: model.id, displayName: model.family || model.id }))
        .filter((model) => model.id.trim().length > 0);

      if (mapped.length > 0) {
        const seen = new Set<string>();
        return mapped.filter((model) => {
          if (seen.has(model.id)) {
            return false;
          }
          seen.add(model.id);
          return true;
        });
      }
    } catch {
      // Ignore and use fallback.
    }

    return [];
  }
}
