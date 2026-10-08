// Live wiring for the prototype: talks to the real API through the server's local bridge (/ui/api).
// The seeker and run ids live in sessionStorage, so each page picks up where the last one left off.
const Live = (() => {
  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
  };

  async function api(method, path, body) {
    const opts = { method, headers: { 'X-Ethera-UI': '1' } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch('/ui/api' + path, opts);
    const json = await res.json().catch(() => ({ ok: false, error: { message: 'Bad response from server' } }));
    if (!json.ok) throw new Error((json.error && json.error.message) || ('HTTP ' + res.status));
    return json.data;
  }

  async function seeker() {
    let id = store.get('seekerId');
    if (id) return id;
    const data = await api('POST', '/v1/seekers', {
      consent: { dataProcessing: true, nameSearch: false, givenAt: new Date().toISOString(), policyVersion: '2026-10-01' },
    });
    store.set('seekerId', data.seekerId);
    return data.seekerId;
  }

  function reset() { ['seekerId', 'runId'].forEach((k) => store.set(k, null)); }

  function banner(text, kind) {
    const d = document.createElement('div');
    d.className = 'live-banner' + (kind ? ' ' + kind : '');
    d.textContent = text;
    d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;max-width:90vw;padding:10px 16px;border-radius:10px;font-size:14px;z-index:99;' +
      (kind === 'error' ? 'background:#3a1414;color:#ffd7d7' : 'background:#1d2a12;color:#d8f5b0');
    document.body.appendChild(d);
    if (kind !== 'error') setTimeout(() => d.remove(), 4000);
    return d;
  }

  return { api, seeker, reset, store, banner };
})();
