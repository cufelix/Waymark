// Live wiring for the prototype: talks to the real API through the server's local bridge (/ui/api).
// The seeker and run ids live in sessionStorage, so each page picks up where the last one left off.
const Live = (() => {
  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} },
  };

  async function api(method, path, body) {
    if (sample) return Sample.api(method, path, body);
    const opts = { method, headers: { 'X-Ethera-UI': '1' } };
    if (body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    const res = await fetch('/ui/api' + path, opts);
    const json = await res.json().catch(() => ({ ok: false, error: { message: 'Bad response from server' } }));
    if (!json.ok) throw new Error((json.error && json.error.message) || ('HTTP ' + res.status));
    return json.data;
  }

  const POLICY_VERSION = '2026-10-01';
  const sample = new URLSearchParams(location.search).get('sample') === '1';

  // GDPR: nothing is stored about the seeker until they agree. Name search is a separate, optional opt-in.
  function askConsent() {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100;padding:16px';
      wrap.innerHTML = '<form class="panel" style="max-width:520px;display:flex;flex-direction:column;gap:14px">' +
        '<div class="panel-title">Before we start</div>' +
        '<p class="hint" style="margin:0">We store your answers, your CV and the links you give us to research jobs for you. You can export or delete everything at any time.</p>' +
        '<label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" id="cData" required> <span>I agree that my answers, CV and links are processed to research jobs for me.</span></label>' +
        '<label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" id="cName"> <span>Optional: you may also search the web for my name to find more of my work.</span></label>' +
        '<button class="cta" type="submit">Start</button></form>';
      document.body.appendChild(wrap);
      wrap.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const consent = { dataProcessing: true, nameSearch: wrap.querySelector('#cName').checked, givenAt: new Date().toISOString(), policyVersion: POLICY_VERSION };
        wrap.remove();
        resolve(consent);
      });
    });
  }

  let pending = null;
  async function seeker() {
    if (sample) { store.set('seekerId', 'skr_SAMPLE_JANE_EXAMPLE'); return 'skr_SAMPLE_JANE_EXAMPLE'; }
    let id = store.get('seekerId');
    if (id) return id;
    // One consent prompt even if several calls ask for the seeker at once.
    pending ??= (async () => {
      const data = await api('POST', '/v1/seekers', { consent: await askConsent() });
      store.set('seekerId', data.seekerId);
      return data.seekerId;
    })().finally(() => { pending = null; });
    return pending;
  }

  function reset() { ['seekerId', 'runId', 'validationId', 'roadmapId', 'chapterId'].forEach((k) => store.set(k, null)); if (sample) Sample.reset(); }

  function href(page) { return page + (sample ? (page.includes('?') ? '&sample=1' : '?sample=1') : ''); }

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

  return { api, seeker, reset, store, banner, sample, href };
})();
