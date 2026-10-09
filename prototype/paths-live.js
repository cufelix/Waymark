const $ = (id) => document.getElementById(id);
const runId = Live.store.get('runId');
const LEVEL = { entry: 'Entry level', junior: 'Junior', mid: 'Mid level', senior: 'Senior', lead: 'Lead', executive: 'Executive' };
let paths = [];
let intake = null;
let profile = null;
let market = [];
let companies = [];
let hiringByPath = new Map();
let openPathIndex = null;
let choosing = false;

function sourceLinks(sources) {
  return (sources || []).filter((source) => source.url).map((source) => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title || 'Source')}</a>`).join(' · ');
}

function evidenceFor(path) {
  const item = intake?.paths.find((candidate) => candidate.occupation.uri === path.occupation.uri);
  if (!item) return '<span>No task-card evidence is available for this path yet.</span>';
  const parts = [];
  if (item.liked) parts.push(`${item.liked} marked “I’d enjoy this”`);
  if (item.maybe) parts.push(`${item.maybe} marked “Maybe”`);
  if (item.notForMe) parts.push(`${item.notForMe} marked “Not for me”`);
  return `<b>${parts.length ? esc(parts.join(' · ')) : 'No task reactions for this path'}</b><span>These counts come directly from your guided intake.</span>`;
}

function salarySummary(path) {
  const salary = (path.ladder || []).map((step) => step.salary).find(Boolean);
  return salary ? `${Math.round(salary.median).toLocaleString()} ${salary.currency} / ${salary.period}` : '';
}

function openRoles(path) {
  const rows = market.filter((item) => item.occupation.uri === path.occupation.uri);
  return rows.length ? rows.reduce((sum, item) => sum + item.vacancyCount, 0) : path.vacancyCount;
}

function render() {
  const labels = ['First in the API order', 'Next in the API order', 'Also in the API order'];
  const shared = (profile?.statedSkills || []).slice(0, 4).map((claim) => (claim.skill && claim.skill.label) || claim.statement);
  $('cards').innerHTML = paths.map((path, i) => {
    const hiring = hiringByPath.get(path.occupation.uri) || [];
    const salary = salarySummary(path);
    const why = (path.why || []).map((claim) => `<p class="one">${esc(claim.statement)} ${sourceLinks(claim.sources)}</p>`).join('');
    return `<article class="pcard">
      <div class="head"><span class="rank">${labels[i] || 'From the API order'}</span><h2>${esc(path.occupation.label)}</h2>${why || '<p class="one">No sourced reason is available yet.</p>'}</div>
      <div class="proof">${evidenceFor(path)}</div>
      <div class="sec" style="border-top:none;padding-top:22px"><span class="lbl">The market</span><div class="big2"><div><b>${openRoles(path) ?? '—'}</b><span>open roles in your selected markets</span></div>${salary ? `<div><b>${esc(salary.split(' / ')[0])}</b><span>${esc(salary.includes(' / ') ? salary.split(' / ').slice(1).join(' / ') : '')}</span></div>` : ''}</div>
        ${hiring.length ? `<div style="display:flex;align-items:center;gap:6px;margin-top:4px"><span style="font-size:13px;color:var(--faint);margin-right:4px">Hiring now</span>${hiring.slice(0, 6).map((company) => `<span class="logo-ph" title="${esc(company.name)}">${esc(company.name.slice(0, 1).toUpperCase())}</span>`).join('')}</div>` : ''}
      </div>
      ${shared.length ? `<div class="sec"><span class="lbl">What you shared</span><div style="display:flex;flex-wrap:wrap;gap:6px">${shared.map((label) => `<span class="chip" style="font-size:13px;padding:5px 10px">${esc(label)}</span>`).join('')}</div></div>` : ''}
      <div class="foot"><button class="cta" type="button" data-choose="${i}">Choose this path</button><button class="textlink" type="button" data-open="${i}">What’s this job like?</button></div>
    </article>`;
  }).join('');
  $('cards').querySelectorAll('[data-open]').forEach((button) => button.onclick = () => openDrawer(Number(button.dataset.open)));
  $('cards').querySelectorAll('[data-choose]').forEach((button) => button.onclick = () => choose(Number(button.dataset.choose), button));
}

function openDrawer(index) {
  openPathIndex = index;
  const path = paths[index];
  $('dTitle').textContent = path.occupation.label;
  const statements = (path.why || []).map((claim) => claim.statement);
  $('dWhat').textContent = statements.length ? statements.join(' ') : 'No sourced job description is available yet.';
  const quotes = (path.why || []).flatMap((claim) => (claim.sources || []).filter((source) => source.quote));
  $('dDay').innerHTML = quotes.length ? quotes.map((source) => `<div class="day"><span>“${esc(source.quote)}”</span><span>${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title || 'Source')}</a>` : 'Internal source'}</span></div>`).join('') : '<p class="hint">No sourced quotes are available for this path.</p>';
  $('dLadder').innerHTML = (path.ladder || []).map((step, i) => {
    const experience = step.typicalExperienceYears ? `${step.typicalExperienceYears.min}${step.typicalExperienceYears.max ? '–' + step.typicalExperienceYears.max : '+'} years` : '';
    const salary = step.salary ? `${Math.round(step.salary.median).toLocaleString()} ${step.salary.currency} / ${step.salary.period}` : '';
    const sources = (step.claims || []).flatMap((claim) => claim.sources || []);
    return `<div class="rung"><div class="rail"><div class="dot ${i === 0 ? 'on' : ''}"></div><div class="bar"></div></div><div class="body"><div><div style="font-weight:600;font-size:15px">${esc(step.title)}</div><div style="font-size:13px;color:var(--muted)">${esc([LEVEL[step.level] || step.level, experience, salary].filter(Boolean).join(' · '))}</div>${sourceLinks(sources)}</div></div></div>`;
  }).join('') || '<p class="hint">No sourced career ladder is available yet.</p>';
  $('scrim').classList.add('open'); $('close').focus();
}

async function waitForDone() {
  while (true) {
    const run = await Live.api('GET', '/v1/research-runs/' + runId);
    if (run.status === 'done') return;
    if (run.status === 'failed' || run.status === 'cancelled') throw new Error(run.error?.message || ('Research is ' + run.status));
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

async function choose(index, button) {
  if (choosing) return;
  choosing = true; const path = paths[index]; const old = button?.textContent;
  if (button) button.textContent = 'Finishing the research…';
  try {
    const seekerId = await Live.seeker();
    await Live.api('PUT', '/v1/seekers/' + seekerId + '/career-choice', { runId, occupationUri: path.occupation.uri });
    await waitForDone();
    profile = await Live.api('GET', '/v1/seekers/' + seekerId + '/profile');
    const validation = await Live.api('POST', '/v1/validations', { profile, runId, occupationUri: path.occupation.uri });
    Live.store.set('validationId', validation.validationId);
    Live.store.set('roadmapId', null);
    Live.store.set('chapterId', null);
    location.href = Live.href('roadmap.html');
  } catch (error) {
    choosing = false; if (button) button.textContent = old;
    Live.banner('Could not choose this path: ' + error.message, 'error');
  }
}

async function loadFinishedDetails() {
  const run = await Live.api('GET', '/v1/research-runs/' + runId);
  if (run.status !== 'done') return;
  [market, companies] = await Promise.all([
    Live.api('GET', '/v1/research-runs/' + runId + '/market'),
    Live.api('GET', '/v1/research-runs/' + runId + '/companies?pageSize=100'),
  ]);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  await Promise.all(paths.map(async (path) => {
    const vacancies = await Live.api('GET', '/v1/research-runs/' + runId + '/vacancies?pageSize=100&occupation=' + encodeURIComponent(path.occupation.uri));
    const seen = new Set();
    hiringByPath.set(path.occupation.uri, vacancies.map((vacancy) => companyById.get(vacancy.companyId)).filter((company) => company && !seen.has(company.id) && seen.add(company.id)));
  }));
  paths = await Live.api('GET', '/v1/research-runs/' + runId + '/career-paths');
  render();
}

async function load() {
  if (!runId) { $('cards').innerHTML = '<p class="hint">No research run is stored. Start from the interview.</p>'; return; }
  try {
    const seekerId = await Live.seeker();
    [paths, profile, intake] = await Promise.all([
      Live.api('GET', '/v1/research-runs/' + runId + '/career-paths'),
      Live.api('GET', '/v1/seekers/' + seekerId + '/profile'),
      Live.api('GET', '/v1/seekers/' + seekerId + '/intake'),
    ]);
    render();
    await loadFinishedDetails();
  } catch (error) { Live.banner('Could not load your paths: ' + error.message, 'error'); }
}

function closeDrawer() { $('scrim').classList.remove('open'); }
$('close').innerHTML = ICON.x; $('close').onclick = closeDrawer;
$('drawerChoose').onclick = () => { if (openPathIndex !== null) choose(openPathIndex, $('drawerChoose')); };
$('scrim').addEventListener('click', (event) => { if (event.target === $('scrim')) closeDrawer(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });
$('moreTasks').href = Live.href('index.html?more=1');
load();
