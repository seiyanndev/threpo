const vscode = require('vscode');
const { SidebarProvider } = require('./src/sidebar');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const sidebar = new SidebarProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('threpo.createRepo', () => sidebar.show('create')),
    // From the Explorer context menu `uri` is the clicked folder; from the palette it is undefined.
    vscode.commands.registerCommand('threpo.publishFolder', (uri) => sidebar.show('publish', uri && uri.fsPath)),
    vscode.commands.registerCommand('threpo.refresh', () => sidebar.refresh()),
    vscode.commands.registerCommand('threpo.switchAccount', () => sidebar.refresh({ switchAccount: true }))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
