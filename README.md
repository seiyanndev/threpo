# Threpo

A VS Code extension that adds a **Threpo** icon to the Activity Bar. Its panel creates GitHub repositories, or creates a repository and pushes a local folder to it, without opening github.com.

## Features

- **New repo**: pick the owner (your account or an organization), name, description and visibility, plus an optional README, `.gitignore` template and license.
- **Publish folder**: creates an empty repo, then runs `git init` (if needed), makes an initial commit (if there is no history), adds `origin` and pushes. Also available by right-clicking a folder in the Explorer and choosing **Publish Folder to New GitHub Repository**.
- **Recently created**: a list of the repos you've created, with links to open, clone or copy the URL.
- Sign-in uses VS Code's built-in GitHub account, so you don't need a personal access token.

## Run it during development

1. Open this folder in VS Code.
2. Press **F5** (the "Run Threpo" launch config). A new Extension Development Host window opens.
3. Click the Threpo icon in the Activity Bar and sign in to GitHub when prompted.

## Install it permanently

```sh
npx @vscode/vsce package --allow-missing-repository
code --install-extension threpo-0.1.0.vsix
```

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `threpo.defaultVisibility` | `private` | Visibility preselected in the form |
| `threpo.defaultOwner` | `""` | Organization preselected as owner |
| `threpo.initializeWithReadme` | `true` | Preselect "Add a README" |
| `threpo.defaultGitignore` | `""` | e.g. `Node`, `WordPress` |
| `threpo.defaultLicense` | `""` | e.g. `mit` |
| `threpo.commitMessage` | `Initial commit` | Used when publishing a folder with no commits |

## Layout

```
extension.js        activation, command registration
src/github.js       GitHub REST API + VS Code GitHub sign-in
src/git.js          local git init/commit/push for "Publish folder"
src/sidebar.js      the Activity Bar webview panel (extension side)
media/main.js|css   the panel UI (webview side)
media/threpo.svg    Activity Bar icon
```
