const vscode = require('vscode');

const API = 'https://api.github.com';
const SCOPES = ['repo', 'read:org'];

/**
 * Uses VS Code's built-in GitHub sign-in, so no personal access token is needed.
 * @param {{ interactive?: boolean, switchAccount?: boolean }} [opts]
 */
async function getSession(opts = {}) {
  if (opts.switchAccount) {
    return vscode.authentication.getSession('github', SCOPES, { clearSessionPreference: true, createIfNone: true });
  }
  if (opts.interactive) {
    return vscode.authentication.getSession('github', SCOPES, { createIfNone: true });
  }
  return vscode.authentication.getSession('github', SCOPES, { silent: true });
}

async function request(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'threpo-vscode',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const details = (data && data.errors ? data.errors : [])
      .map((e) => e.message || `${e.field} ${e.code}`)
      .join('; ');
    const message = (data && data.message) || res.statusText;
    throw new Error(`GitHub: ${message}${details ? ` (${details})` : ''}`);
  }
  return data;
}

const getUser = (token) => request(token, 'GET', '/user');
const listOrgs = (token) => request(token, 'GET', '/user/orgs?per_page=100');
const listGitignoreTemplates = (token) => request(token, 'GET', '/gitignore/templates');
const listLicenses = (token) => request(token, 'GET', '/licenses?per_page=100');

/**
 * @param {string} token
 * @param {{ owner?: string, name: string, description?: string, private: boolean,
 *           autoInit?: boolean, gitignore?: string, license?: string }} opts
 *   `owner` is an organization login; empty means the signed-in user's account.
 */
function createRepo(token, opts) {
  const body = {
    name: opts.name,
    private: opts.private,
    auto_init: Boolean(opts.autoInit || opts.gitignore || opts.license),
  };
  if (opts.description) body.description = opts.description;
  if (opts.gitignore) body.gitignore_template = opts.gitignore;
  if (opts.license) body.license_template = opts.license;

  const path = opts.owner ? `/orgs/${encodeURIComponent(opts.owner)}/repos` : '/user/repos';
  return request(token, 'POST', path, body);
}

module.exports = { getSession, getUser, listOrgs, listGitignoreTemplates, listLicenses, createRepo };
