// @ts-check
(function () {
  // @ts-ignore provided by the VS Code webview host
  const vscode = acquireVsCodeApi();
  const $ = (id) => /** @type {any} */ (document.getElementById(id));

  const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
  const saved = vscode.getState() || {};
  let mode = saved.mode || 'create';
  let state = null;
  let defaultsApplied = false;
  let nameEdited = false;
  let busy = false;

  // ---- messages from the extension -------------------------------------------------

  window.addEventListener('message', ({ data: msg }) => {
    switch (msg.type) {
      case 'signedOut':
        show('signedOut');
        break;
      case 'state':
        state = msg;
        render();
        show('app');
        break;
      case 'setMode':
        if (msg.folder) ensureFolderOption(msg.folder, true);
        setMode(msg.mode);
        break;
      case 'busy':
        setBusy(true);
        status('busy', msg.text);
        break;
      case 'done':
        setBusy(false);
        statusDone(msg.text, msg.repo);
        renderRecent(msg.recent);
        $('name').value = '';
        $('description').value = '';
        nameEdited = false;
        updateNameHint();
        break;
      case 'error':
        setBusy(false);
        if (state) {
          status('error', msg.message);
        } else {
          // Failed before the form could load (e.g. offline) — offer sign-in/retry instead.
          show('signedOut');
          $('signedOutError').textContent = msg.message;
        }
        break;
    }
  });

  // ---- rendering --------------------------------------------------------------------

  function show(section) {
    for (const id of ['loading', 'signedOut', 'app']) $(id).hidden = id !== section;
  }

  function render() {
    $('avatar').src = state.user.avatar;
    $('login').textContent = state.user.login;

    const d = state.defaults;
    fillSelect($('owner'), [
      { value: '', label: `${state.user.login} (personal)` },
      ...state.orgs.map((o) => ({ value: o, label: o })),
    ], defaultsApplied ? undefined : d.owner);

    fillSelect($('gitignore'), [
      { value: '', label: 'None' },
      ...state.gitignores.map((g) => ({ value: g, label: g })),
    ], defaultsApplied ? undefined : d.gitignore);

    fillSelect($('license'), [
      { value: '', label: 'None' },
      ...state.licenses.map((l) => ({ value: l.key, label: l.name })),
    ], defaultsApplied ? undefined : d.license);

    const current = $('folder').value;
    fillSelect($('folder'), state.folders.map((f) => ({ value: f.path, label: f.name })));
    if (current) ensureFolderOption(current, true);

    if (!defaultsApplied) {
      const vis = document.querySelector(`input[name="visibility"][value="${d.visibility}"]`);
      if (vis) /** @type {HTMLInputElement} */ (vis).checked = true;
      $('readme').checked = d.readme;
      defaultsApplied = true;
    }

    renderRecent(state.recent);
    setMode(mode);
  }

  /** Replaces a select's options, keeping the current choice when it still exists. */
  function fillSelect(select, options, preferred) {
    const keep = preferred !== undefined && preferred !== '' ? preferred : select.value;
    select.replaceChildren(...options.map((o) => new Option(o.label, o.value)));
    if (options.some((o) => o.value === keep)) select.value = keep;
  }

  function ensureFolderOption(folderPath, select) {
    const sel = $('folder');
    if (![...sel.options].some((o) => o.value === folderPath)) {
      sel.add(new Option(basename(folderPath), folderPath));
    }
    if (select) {
      sel.value = folderPath;
      suggestName();
    }
  }

  function setMode(next) {
    mode = next === 'publish' ? 'publish' : 'create';
    vscode.setState({ ...vscode.getState(), mode });
    document.body.dataset.mode = mode;
    for (const tab of document.querySelectorAll('.tab')) {
      const active = /** @type {HTMLElement} */ (tab).dataset.mode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    $('submit').textContent = mode === 'publish' ? 'Create & publish folder' : 'Create repository';
    if (mode === 'publish') suggestName();
    updateNameHint();
  }

  function renderRecent(recent) {
    const list = $('recent');
    list.replaceChildren();
    $('recentSection').hidden = !recent || recent.length === 0;
    for (const repo of recent || []) {
      const li = document.createElement('li');
      const name = document.createElement('a');
      name.href = '#';
      name.textContent = repo.fullName;
      name.title = 'Open on GitHub';
      name.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'open', url: repo.htmlUrl });
      });
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = repo.private ? 'private' : 'public';
      const actions = document.createElement('span');
      actions.className = 'actions';
      actions.append(
        actionLink('Clone', () => vscode.postMessage({ type: 'clone', url: repo.cloneUrl })),
        actionLink('Copy URL', () => vscode.postMessage({ type: 'copy', url: repo.cloneUrl }))
      );
      li.append(name, badge, actions);
      list.append(li);
    }
  }

  function actionLink(label, onClick) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      onClick();
    });
    return a;
  }

  function status(kind, text) {
    const el = $('status');
    el.className = kind;
    el.textContent = text;
  }

  function statusDone(text, repo) {
    status('success', text + ' ');
    $('status').append(
      actionLink('Open', () => vscode.postMessage({ type: 'open', url: repo.htmlUrl })),
      document.createTextNode(' · '),
      actionLink('Copy URL', () => vscode.postMessage({ type: 'copy', url: repo.cloneUrl }))
    );
  }

  function setBusy(value) {
    busy = value;
    for (const el of $('form').elements) el.disabled = value;
  }

  // ---- name helpers -----------------------------------------------------------------

  function basename(p) {
    return p.split(/[\\/]/).filter(Boolean).pop() || p;
  }

  function sanitizeName(s) {
    return s.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  }

  function suggestName() {
    const folder = $('folder').value;
    if (mode === 'publish' && folder && !nameEdited) {
      $('name').value = sanitizeName(basename(folder));
      updateNameHint();
    }
  }

  function updateNameHint() {
    const name = $('name').value.trim();
    const hint = $('nameHint');
    hint.classList.remove('invalid');
    if (!name) {
      hint.textContent = '';
    } else if (!NAME_RE.test(name)) {
      hint.textContent = 'Use letters, numbers, ".", "-" or "_" only.';
      hint.classList.add('invalid');
    } else if (state) {
      const owner = $('owner').value || state.user.login;
      hint.textContent = `github.com/${owner}/${name}`;
    }
  }

  // ---- events -----------------------------------------------------------------------

  $('signIn').addEventListener('click', () => vscode.postMessage({ type: 'signIn' }));
  $('switchAccount').addEventListener('click', (e) => {
    e.preventDefault();
    vscode.postMessage({ type: 'switchAccount' });
  });
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => setMode(/** @type {HTMLElement} */ (tab).dataset.mode));
  }
  $('browse').addEventListener('click', () => vscode.postMessage({ type: 'browseFolder' }));
  $('folder').addEventListener('change', suggestName);
  $('owner').addEventListener('change', updateNameHint);
  $('name').addEventListener('input', () => {
    nameEdited = $('name').value.trim() !== '';
    updateNameHint();
  });

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const name = $('name').value.trim();
    if (!NAME_RE.test(name)) {
      status('error', 'Enter a valid repository name.');
      $('name').focus();
      return;
    }
    const visibility = /** @type {HTMLInputElement | null} */ (
      document.querySelector('input[name="visibility"]:checked')
    );
    const form = {
      owner: $('owner').value,
      name,
      description: $('description').value.trim(),
      visibility: visibility ? visibility.value : 'private',
      readme: $('readme').checked,
      gitignore: $('gitignore').value,
      license: $('license').value,
      folder: $('folder').value,
    };
    if (mode === 'publish' && !form.folder) {
      status('error', 'Choose a folder to publish.');
      return;
    }
    status('', '');
    vscode.postMessage({ type: mode, form });
  });

  vscode.postMessage({ type: 'ready' });
})();
