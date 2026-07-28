// Mink VS Code extension (spec 31) — a thin client over the `mink` CLI. Each
// command builds an invocation via the (unit-tested) cli-bridge, runs it in the
// workspace, and streams the result into a "Mink" output channel. No Mink logic
// is reimplemented here.
//
// The VS Code API glue below cannot run headless; it is exercised in a VS Code
// Extension Development Host. All decision logic lives in cli-bridge.ts, which
// is unit-tested.

import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { buildMinkCommand, relativePathFor, type MinkAction } from "./cli-bridge";

let channel: vscode.OutputChannel;

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function runMink(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const proc = spawn("mink", args, { cwd });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => resolve({ code: -1, out, err: err + String(e) }));
    proc.on("close", (code) => resolve({ code: code ?? 0, out, err }));
  });
}

async function runAction(action: MinkAction, input?: string): Promise<void> {
  const cwd = workspaceRoot();
  if (!cwd) {
    vscode.window.showWarningMessage("Mink: open a workspace folder first.");
    return;
  }
  let cmd;
  try {
    cmd = buildMinkCommand(action, input);
  } catch (e) {
    vscode.window.showWarningMessage(`Mink: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  channel.show(true);
  channel.appendLine(`\n$ mink ${cmd.args.join(" ")}`);
  const { code, out, err } = await runMink(cmd.args, cwd);
  if (out) channel.append(out);
  if (err) channel.append(err);
  if (code === -1) {
    vscode.window.showErrorMessage("Mink: could not run the `mink` CLI — is it installed and on PATH?");
  }
}

export function activate(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel("Mink");
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand("mink.contextPack", () => runAction("context")),

    vscode.commands.registerCommand("mink.searchBugs", async () => {
      const q = await vscode.window.showInputBox({ prompt: "Search Mink bug memory" });
      if (q) await runAction("bug-search", q);
    }),

    vscode.commands.registerCommand("mink.captureNote", async () => {
      const text = await vscode.window.showInputBox({ prompt: "Capture a note to the Mink vault" });
      if (text) await runAction("note", text);
    }),

    vscode.commands.registerCommand("mink.similarTasks", async () => {
      const editor = vscode.window.activeTextEditor;
      const root = workspaceRoot();
      if (!editor || !root) {
        vscode.window.showWarningMessage("Mink: open a file in a workspace first.");
        return;
      }
      await runAction("similar", relativePathFor(root, editor.document.uri.fsPath));
    })
  );
}

export function deactivate(): void {
  channel?.dispose();
}
