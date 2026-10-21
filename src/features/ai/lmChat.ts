import * as vscode from "vscode";

/**
 * Language-model access via the platform API (`vscode.lm`) — models are
 * provided by the user's own setup (e.g. GitHub Copilot). GitNexus never
 * ships or requires its own AI key.
 */
export async function pickChatModel(): Promise<vscode.LanguageModelChat | undefined> {
  const copilot = await vscode.lm.selectChatModels({ vendor: "copilot" }).then(m => m, () => []);
  if (copilot.length > 0) return copilot[0];
  const any = await vscode.lm.selectChatModels({}).then(m => m, () => []);
  return any[0];
}

export async function askModel(
  model: vscode.LanguageModelChat,
  prompt: string,
  token: vscode.CancellationToken
): Promise<string> {
  const response = await model.sendRequest(
    [vscode.LanguageModelChatMessage.User(prompt)],
    {},
    token
  );
  let text = "";
  for await (const chunk of response.text) text += chunk;
  return text.trim();
}
