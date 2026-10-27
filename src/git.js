const vscode = require('vscode');
const path = require('path');
const { execFile } = require('child_process');

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || '').trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

const tryGit = (cwd, args) => git(cwd, args).catch(() => null);

function samePath(a, b) {
  const norm = (p) => {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return norm(a) === norm(b);
}

/**
 * Makes `folder` a git repo (if needed), commits its contents when there is no
 * history yet, adds `cloneUrl` as `origin` and pushes the current branch.
 * @param {(text: string) => void} report progress callback
 */
async function publishFolder(folder, cloneUrl, commitMessage, report) {
  const topLevel = await tryGit(folder, ['rev-parse', '--show-toplevel']);
  if (!topLevel || !samePath(topLevel, folder)) {
    report('Initializing git repository…');
    await git(folder, ['init', '-b', 'main']);
  }

  if (await tryGit(folder, ['remote', 'get-url', 'origin'])) {
    throw new Error('This folder already has an "origin" remote. Remove it first or publish another folder.');
  }

  if (!(await tryGit(folder, ['rev-parse', '--verify', 'HEAD']))) {
    report('Creating initial commit…');
    await git(folder, ['add', '-A']);
    await git(folder, ['commit', '--allow-empty', '-m', commitMessage]);
  }

  await git(folder, ['remote', 'add', 'origin', cloneUrl]);
  const branch = await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']);

  report(`Pushing ${branch} to GitHub…`);
  await push(folder, branch);
  return branch;
}

/** Push through VS Code's Git extension so it handles GitHub credentials; fall back to the CLI. */
async function push(folder, branch) {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (ext) {
    const api = (ext.isActive ? ext.exports : await ext.activate()).getAPI(1);
    const uri = vscode.Uri.file(folder);
    const repo = api.getRepository(uri) || (await api.openRepository(uri));
    if (repo) {
      await repo.push('origin', branch, true);
      return;
    }
  }
  await git(folder, ['push', '-u', 'origin', branch]);
}

module.exports = { publishFolder };
