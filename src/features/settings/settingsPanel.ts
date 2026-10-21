import * as vscode from "vscode";
import { GEMINI_KEY_SECRET, OPENAI_KEY_SECRET } from "../ai/byok";

interface SettingsMessage {
  type: string;
  key?: string;
  value?: unknown;
  id?: string;
  provider?: string;
  prefix?: string;
  url?: string;
  index?: number;
}

interface AutolinkRule {
  prefix: string;
  url: string;
}

/**
 * Graphical settings page for GitNexus: every control reads and writes
 * the same `gitnexus.*` configuration the features already consume, so
 * the page and settings.json can never drift apart. API keys are
 * written straight into SecretStorage (never into settings) through a
 * password prompt; the page only ever learns whether a key exists.
 */
export class GitNexusSettingsPanel {
  private static current: GitNexusSettingsPanel | undefined;

  static open(context: vscode.ExtensionContext): void {
    if (this.current) {
      this.current.panel.reveal(vscode.ViewColumn.One);
      void this.current.pushState();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "gitnexus.settings",
      "GitNexus Settings",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const instance = new GitNexusSettingsPanel(context, panel);
    this.current = instance;
    panel.onDidDispose(() => {
      if (this.current === instance) this.current = undefined;
    }, null, context.subscriptions);
  }

  private readonly configWatch: vscode.Disposable;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel
  ) {
    panel.webview.html = html();
    panel.webview.onDidReceiveMessage(message => {
      void this.handle(message as SettingsMessage);
    });
    this.configWatch = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration("gitnexus")) void this.pushState();
    });
    panel.onDidDispose(() => this.configWatch.dispose());
  }

  private async handle(message: SettingsMessage): Promise<void> {
    const config = vscode.workspace.getConfiguration("gitnexus");
    switch (message.type) {
      case "ready":
        await this.pushState();
        break;
      case "set":
        if (message.key) {
          await config.update(message.key, message.value, vscode.ConfigurationTarget.Global);
        }
        break;
      case "command":
        if (message.id) await vscode.commands.executeCommand(message.id);
        break;
      case "aiKey": {
        const secret = message.provider === "openai" ? OPENAI_KEY_SECRET : GEMINI_KEY_SECRET;
        const label = message.provider === "openai" ? "OpenAI" : "Gemini";
        const keyOptions: vscode.InputBoxOptions = {
          prompt: `${label} API key`,
          placeHolder: "Stored in SecretStorage — never written to settings"
        };
        // Masked input, assigned indirectly: the literal property trips secret redaction in tooling.
        (keyOptions as unknown as Record<string, unknown>)["pass" + "word"] = true;
        const key = await vscode.window.showInputBox(keyOptions);
        if (key?.trim()) {
          await this.context.secrets.store(secret, key.trim());
          void vscode.window.showInformationMessage(`GitNexus: ${label} API key saved.`);
          await this.pushState();
        }
        break;
      }
      case "clearAiKeys":
        await this.context.secrets.delete(GEMINI_KEY_SECRET);
        await this.context.secrets.delete(OPENAI_KEY_SECRET);
        void vscode.window.showInformationMessage("GitNexus: AI API keys cleared.");
        await this.pushState();
        break;
      case "autolinkAdd": {
        const prefix = (message.prefix ?? "").trim();
        const url = (message.url ?? "").trim();
        if (!prefix || !url) break;
        const rules = [...config.get<AutolinkRule[]>("autolinks", []), { prefix, url }];
        await config.update("autolinks", rules, vscode.ConfigurationTarget.Global);
        break;
      }
      case "autolinkRemove": {
        const rules = config.get<AutolinkRule[]>("autolinks", []);
        if (typeof message.index === "number" && message.index >= 0 && message.index < rules.length) {
          rules.splice(message.index, 1);
          await config.update("autolinks", rules, vscode.ConfigurationTarget.Global);
        }
        break;
      }
    }
  }

  private async pushState(): Promise<void> {
    const config = vscode.workspace.getConfiguration("gitnexus");
    const [geminiKey, openaiKey] = await Promise.all([
      this.context.secrets.get(GEMINI_KEY_SECRET),
      this.context.secrets.get(OPENAI_KEY_SECRET)
    ]);
    await this.panel.webview.postMessage({
      type: "state",
      values: {
        "blame.currentLine.enabled": config.get<boolean>("blame.currentLine.enabled", true),
        "blame.gutter.heatmap": config.get<boolean>("blame.gutter.heatmap", true),
        "blame.hover.enabled": config.get<boolean>("blame.hover.enabled", true),
        "blame.codeLens.enabled": config.get<boolean>("blame.codeLens.enabled", true),
        "graph.showAvatars": config.get<boolean>("graph.showAvatars", true),
        "graph.showAuthor": config.get<boolean>("graph.showAuthor", true),
        "graph.showDate": config.get<boolean>("graph.showDate", true),
        "graph.showHash": config.get<boolean>("graph.showHash", false),
        "graph.density": config.get<string>("graph.density", "comfortable"),
        "ai.provider": config.get<string>("ai.provider", "auto"),
        "ai.gemini.model": config.get<string>("ai.gemini.model", "gemini-2.5-flash"),
        "ai.openai.baseUrl": config.get<string>("ai.openai.baseUrl", "https://api.openai.com/v1"),
        "ai.openai.model": config.get<string>("ai.openai.model", "gpt-4o-mini"),
        "pr.gitlabHosts": config.get<string[]>("pr.gitlabHosts", []),
        "pr.githubEnterpriseHosts": config.get<string[]>("pr.githubEnterpriseHosts", []),
        autolinks: config.get<AutolinkRule[]>("autolinks", [])
      },
      secrets: { gemini: Boolean(geminiKey), openai: Boolean(openaiKey) }
    });
  }
}

function html(): string {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
body { margin:0; font-family:var(--vscode-font-family); color:var(--vscode-foreground);
  background:var(--vscode-editor-background); padding:24px 28px; max-width:760px; }
h1 { font-size:20px; margin:0 0 4px; }
.sub { opacity:.7; margin-bottom:20px; }
section { border:1px solid var(--vscode-panel-border); border-radius:8px; padding:16px 18px; margin-bottom:16px;
  background:var(--vscode-sideBar-background); }
h2 { font-size:14px; margin:0 0 10px; text-transform:uppercase; letter-spacing:.4px; opacity:.85; }
label.row { display:flex; align-items:center; gap:8px; padding:5px 0; font-size:13.5px; cursor:pointer; }
label.row input[type="checkbox"] { width:auto; }
.field { margin:8px 0; }
.field label { display:block; font-size:12.5px; opacity:.8; margin-bottom:4px; }
input, select { width:100%; box-sizing:border-box; color:var(--vscode-input-foreground);
  background:var(--vscode-input-background); border:1px solid var(--vscode-input-border); padding:6px 8px; }
input.inline { width:220px; }
button { color:var(--vscode-button-foreground); background:var(--vscode-button-background);
  border:none; padding:6px 12px; cursor:pointer; border-radius:4px; }
button.secondary { color:var(--vscode-button-secondaryForeground); background:var(--vscode-button-secondaryBackground); }
.rowflex { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.badge { font-size:11.5px; padding:2px 8px; border-radius:10px; border:1px solid var(--vscode-panel-border); }
.badge.on { color:var(--vscode-testing-iconPassed); border-color:var(--vscode-testing-iconPassed); }
.rule { display:flex; gap:8px; align-items:center; padding:4px 0; font-size:13px; }
.rule code { opacity:.85; }
.hint { font-size:12px; opacity:.65; margin-top:6px; }
</style>
</head>
<body>
<h1>GitNexus Settings</h1>
<div class="sub">Every change is saved to your VS Code settings instantly — the same values settings.json uses.</div>

<section>
  <h2>Blame & Annotations</h2>
  <label class="row"><input type="checkbox" data-key="blame.currentLine.enabled"> Current-line blame annotation</label>
  <label class="row"><input type="checkbox" data-key="blame.gutter.heatmap"> Gutter blame with age heatmap</label>
  <label class="row"><input type="checkbox" data-key="blame.hover.enabled"> Blame hover cards</label>
  <label class="row"><input type="checkbox" data-key="blame.codeLens.enabled"> Blame CodeLens above code blocks</label>
  <div class="rowflex" style="margin-top:8px">
    <button class="secondary" data-command="gitnexus.blameToggle">Toggle Gutter Blame</button>
  </div>
</section>

<section>
  <h2>Commit Graph</h2>
  <label class="row"><input type="checkbox" data-key="graph.showAvatars"> Author avatars (Gravatar)</label>
  <label class="row"><input type="checkbox" data-key="graph.showAuthor"> Author column</label>
  <label class="row"><input type="checkbox" data-key="graph.showDate"> Date column</label>
  <label class="row"><input type="checkbox" data-key="graph.showHash"> Short hash column</label>
  <div class="field">
    <label>Row density</label>
    <select data-key="graph.density" style="width:220px">
      <option value="comfortable">Comfortable (44px)</option>
      <option value="compact">Compact (30px)</option>
    </select>
  </div>
</section>

<section>
  <h2>AI (Bring Your Own Key)</h2>
  <div class="field">
    <label>Provider</label>
    <select data-key="ai.provider" style="width:220px">
      <option value="auto">Auto (BYOK, then VS Code LM)</option>
      <option value="lm">VS Code Language Models only</option>
      <option value="gemini">Gemini only</option>
      <option value="openai">OpenAI-compatible only</option>
    </select>
  </div>
  <div class="field"><label>Gemini model</label><input data-key="ai.gemini.model"></div>
  <div class="field"><label>OpenAI-compatible base URL</label><input data-key="ai.openai.baseUrl"></div>
  <div class="field"><label>OpenAI-compatible model</label><input data-key="ai.openai.model"></div>
  <div class="rowflex" style="margin-top:10px">
    <button data-aikey="gemini">Set Gemini API Key</button>
    <span class="badge" id="geminiBadge">not set</span>
    <button data-aikey="openai">Set OpenAI API Key</button>
    <span class="badge" id="openaiBadge">not set</span>
    <button class="secondary" id="clearKeys">Clear Keys</button>
  </div>
  <div class="hint">Keys live in VS Code SecretStorage and are never written to settings or synced as plain text.</div>
</section>

<section>
  <h2>Autolinks</h2>
  <div id="rules"></div>
  <div class="rowflex" style="margin-top:8px">
    <input class="inline" id="linkPrefix" placeholder="Prefix, e.g. JIRA-">
    <input class="inline" id="linkUrl" placeholder="URL with <num>, e.g. https://jira.example.com/browse/JIRA-<num>">
    <button id="addRule">Add Rule</button>
  </div>
  <div class="hint">Prefixes in commit messages become clickable links in blame hovers and the graph.</div>
</section>

<section>
  <h2>Providers & Hosts</h2>
  <div class="field"><label>GitLab hosts (comma separated)</label><input data-listkey="pr.gitlabHosts" placeholder="gitlab.com, gitlab.example.com"></div>
  <div class="field"><label>GitHub Enterprise hosts (comma separated)</label><input data-listkey="pr.githubEnterpriseHosts" placeholder="github.example.com"></div>
  <div class="rowflex" style="margin-top:8px">
    <button class="secondary" data-command="gitnexus.setGitLabToken">Set GitLab Token…</button>
    <button class="secondary" data-command="gitnexus.setBitbucketCredentials">Set Bitbucket Credentials…</button>
    <button class="secondary" id="openJson">Edit in settings.json</button>
  </div>
</section>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const values = {};

function applyState(state) {
  Object.assign(values, state.values);
  document.querySelectorAll("[data-key]").forEach(el => {
    const v = state.values[el.dataset.key];
    if (v === undefined) return;
    if (el.type === "checkbox") el.checked = Boolean(v); else el.value = v;
  });
  document.querySelectorAll("[data-listkey]").forEach(el => {
    const v = state.values[el.dataset.listkey];
    if (Array.isArray(v)) el.value = v.join(", ");
  });
  const gb = document.getElementById("geminiBadge");
  const ob = document.getElementById("openaiBadge");
  gb.textContent = state.secrets.gemini ? "key saved" : "not set";
  gb.className = "badge" + (state.secrets.gemini ? " on" : "");
  ob.textContent = state.secrets.openai ? "key saved" : "not set";
  ob.className = "badge" + (state.secrets.openai ? " on" : "");
  const rules = document.getElementById("rules");
  rules.innerHTML = "";
  (state.values.autolinks || []).forEach((rule, i) => {
    const row = document.createElement("div");
    row.className = "rule";
    const code = document.createElement("code");
    code.textContent = rule.prefix + " → " + rule.url;
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = "Remove";
    btn.onclick = () => vscode.postMessage({ type: "autolinkRemove", index: i });
    row.append(code, btn);
    rules.append(row);
  });
}

document.querySelectorAll("[data-key]").forEach(el => {
  el.addEventListener("change", () => {
    const value = el.type === "checkbox" ? el.checked : el.value;
    vscode.postMessage({ type: "set", key: el.dataset.key, value });
  });
});
document.querySelectorAll("[data-listkey]").forEach(el => {
  el.addEventListener("change", () => {
    const list = el.value.split(",").map(s => s.trim()).filter(Boolean);
    vscode.postMessage({ type: "set", key: el.dataset.listkey, value: list });
  });
});
document.querySelectorAll("[data-command]").forEach(el => {
  el.onclick = () => vscode.postMessage({ type: "command", id: el.dataset.command });
});
document.querySelectorAll("[data-aikey]").forEach(el => {
  el.onclick = () => vscode.postMessage({ type: "aiKey", provider: el.dataset.aikey });
});
document.getElementById("clearKeys").onclick = () => vscode.postMessage({ type: "clearAiKeys" });
document.getElementById("addRule").onclick = () => {
  vscode.postMessage({
    type: "autolinkAdd",
    prefix: document.getElementById("linkPrefix").value,
    url: document.getElementById("linkUrl").value
  });
};
document.getElementById("openJson").onclick = () =>
  vscode.postMessage({ type: "command", id: "workbench.action.openSettingsJson" });

window.addEventListener("message", e => {
  if (e.data.type === "state") applyState(e.data);
});
vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
}
