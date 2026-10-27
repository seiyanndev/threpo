const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');
const github = require('./github');
const { publishFolder } = require('./git');

const RECENT_KEY = 'threpo.recent';
const RECENT_LIMIT = 8;

class SidebarProvider {
  static viewId = 'threpo.sidebar';

  /** @param {vscode.ExtensionContext} context */
  constructor(context) {
    this.context = context;
    /** @type {vscode.WebviewView | undefined} */
    this.view = undefined;
    this.ready = false;
    this.pending = [];
    this.metaCache = null; // gitignore templates + licenses rarely change

    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.authentication.onDidChangeSessions((e) => {
        if (e.provider.id === 'github') this.refresh();
      })
    );
  }

  /** @param {vscode.WebviewView} view */
  resolveWebviewView(view) {
    this.view = view;
    this.ready = false;
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);

    view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  /** Opens the panel and switches the form to the given mode. */
  async show(mode, folder) {
    await vscode.commands.executeCommand(`${SidebarProvider.viewId}.focus`);
    this.post({ type: 'setMode', mode, folder });
  }

  post(msg) {
    if (this.view && this.ready) this.view.webview.postMessage(msg);
    else this.pending.push(msg);
  }

  async onMessage(msg) {
    try {
      switch (msg.type) {
        case 'ready':
          this.ready = true;
          await this.refresh();
          this.pending.splice(0).forEach((m) => this.post(m));
          break;
        case 'signIn':
          await this.refresh({ interactive: true });
          break;
        case 'switchAccount':
          await this.refresh({ switchAccount: true });
          break;
        case 'create':
          await this.create(msg.form);
          break;
        case 'publish':
          await this.publish(msg.form);
          break;
        case 'open':
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          break;
        case 'clone':
          await vscode.commands.executeCommand('git.clone', msg.url);
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(msg.url);
          vscode.window.setStatusBarMessage('Threpo: URL copied', 2000);
          break;
        case 'browseFolder':
          await this.browseFolder();
          break;
      }
    } catch (err) {
      this.post({ type: 'error', message: errorMessage(err) });
    }
  }

  async refresh(authOpts = {}) {
    if (!this.view) return;
    try {
      await this.loadState(authOpts);
    } catch (err) {
      this.post({ type: 'error', message: errorMessage(err) });
    }
  }

  async loadState(authOpts) {
    const session = await github.getSession(authOpts).catch(() => undefined);
    if (!session) {
      this.post({ type: 'signedOut' });
      return;
    }
    const token = session.accessToken;
    const [user, orgs, meta] = await Promise.all([
      github.getUser(token),
      github.listOrgs(token).catch(() => []),
      this.loadMeta(token),
    ]);
    const config = vscode.workspace.getConfiguration('threpo');
    this.post({
      type: 'state',
      user: { login: user.login, avatar: user.avatar_url },
      orgs: orgs.map((o) => o.login),
      gitignores: meta.gitignores,
      licenses: meta.licenses,
      folders: (vscode.workspace.workspaceFolders || []).map((f) => ({ name: f.name, path: f.uri.fsPath })),
      recent: this.context.globalState.get(RECENT_KEY, []),
      defaults: {
        owner: config.get('defaultOwner'),
        visibility: config.get('defaultVisibility'),
        readme: config.get('initializeWithReadme'),
        gitignore: config.get('defaultGitignore'),
        license: config.get('defaultLicense'),
      },
    });
  }

  async loadMeta(token) {
    if (!this.metaCache) {
      const [gitignores, licenses] = await Promise.all([
        github.listGitignoreTemplates(token).catch(() => []),
        github.listLicenses(token).catch(() => []),
      ]);
      this.metaCache = { gitignores, licenses: licenses.map((l) => ({ key: l.key, name: l.name })) };
    }
    return this.metaCache;
  }

  async browseFolder() {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      openLabel: 'Publish this folder',
    });
    if (picked && picked[0]) this.post({ type: 'setMode', mode: 'publish', folder: picked[0].fsPath });
  }

  async create(form) {
    const session = await github.getSession({ interactive: true });
    this.post({ type: 'busy', text: `Creating ${form.name}…` });
    const repo = await github.createRepo(session.accessToken, {
      owner: form.owner,
      name: form.name,
      description: form.description,
      private: form.visibility === 'private',
      autoInit: form.readme,
      gitignore: form.gitignore,
      license: form.license,
    });
    await this.done(repo, `Created ${repo.full_name}`);
  }

  async publish(form) {
    if (!form.folder) throw new Error('Choose a folder to publish.');
    const session = await github.getSession({ interactive: true });
    this.post({ type: 'busy', text: `Creating ${form.name}…` });
    const repo = await github.createRepo(session.accessToken, {
      owner: form.owner,
      name: form.name,
      description: form.description,
      private: form.visibility === 'private',
      autoInit: false, // the pushed folder supplies the first commit
    });
    try {
      const commitMessage = vscode.workspace.getConfiguration('threpo').get('commitMessage') || 'Initial commit';
      await publishFolder(form.folder, repo.clone_url, commitMessage, (text) => this.post({ type: 'busy', text }));
    } catch (err) {
      await this.remember(repo);
      throw new Error(`${repo.full_name} was created, but publishing the folder failed: ${errorMessage(err)}`);
    }
    await this.done(repo, `Published ${path.basename(form.folder)} to ${repo.full_name}`);
  }

  async done(repo, text) {
    await this.remember(repo);
    this.post({ type: 'done', text, repo: toRecent(repo), recent: this.context.globalState.get(RECENT_KEY, []) });
    const choice = await vscode.window.showInformationMessage(text, 'Open on GitHub');
    if (choice) await vscode.env.openExternal(vscode.Uri.parse(repo.html_url));
  }

  async remember(repo) {
    const recent = this.context.globalState.get(RECENT_KEY, []).filter((r) => r.fullName !== repo.full_name);
    recent.unshift(toRecent(repo));
    await this.context.globalState.update(RECENT_KEY, recent.slice(0, RECENT_LIMIT));
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'main.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'main.js'));
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css}">
</head>
<body>
  <div id="loading" class="muted">Loading…</div>

  <div id="signedOut" hidden>
    <p>Sign in with GitHub to create repositories from this panel.</p>
    <button id="signIn" class="primary">Sign in to GitHub</button>
    <p id="signedOutError" class="error-text"></p>
  </div>

  <div id="app" hidden>
    <div class="account">
      <img id="avatar" alt="">
      <span id="login"></span>
      <a href="#" id="switchAccount">Switch</a>
    </div>

    <div class="tabs" role="tablist">
      <button type="button" class="tab" data-mode="create" role="tab">New repo</button>
      <button type="button" class="tab" data-mode="publish" role="tab">Publish folder</button>
    </div>

    <form id="form" novalidate>
      <div class="field publish-only">
        <label for="folder">Folder</label>
        <div class="row">
          <select id="folder"></select>
          <button type="button" id="browse" class="icon" title="Choose another folder">…</button>
        </div>
      </div>

      <div class="field">
        <label for="owner">Owner</label>
        <select id="owner"></select>
      </div>

      <div class="field">
        <label for="name">Repository name</label>
        <input id="name" autocomplete="off" spellcheck="false">
        <div id="nameHint" class="hint"></div>
      </div>

      <div class="field">
        <label for="description">Description <span class="muted">(optional)</span></label>
        <input id="description" autocomplete="off">
      </div>

      <div class="field radios">
        <label><input type="radio" name="visibility" value="private"> Private</label>
        <label><input type="radio" name="visibility" value="public"> Public</label>
      </div>

      <div class="create-only">
        <label class="check"><input type="checkbox" id="readme"> Add a README</label>
        <div class="field">
          <label for="gitignore">.gitignore template</label>
          <select id="gitignore"></select>
        </div>
        <div class="field">
          <label for="license">License</label>
          <select id="license"></select>
        </div>
      </div>

      <button type="submit" id="submit" class="primary"></button>
    </form>

    <div id="status" role="status"></div>

    <section id="recentSection" hidden>
      <h3>Recently created</h3>
      <ul id="recent"></ul>
    </section>
  </div>

  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

function toRecent(repo) {
  return { fullName: repo.full_name, htmlUrl: repo.html_url, cloneUrl: repo.clone_url, private: repo.private };
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

module.exports = { SidebarProvider };
