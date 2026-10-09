const $ = (id) => document.getElementById(id);
const STEPS = [
  { key: 'career-paths', label: 'Picking your career paths', unit: 'paths' },
  { key: 'companies', label: 'Checking companies hiring', unit: 'companies' },
  { key: 'vacancies', label: 'Reading job ads', unit: 'ads' },
  { key: 'market', label: 'Checking what employers ask for', unit: 'markets' },
  { key: 'seeker-research', label: 'Reading the links you shared', unit: 'links' },
];
const DONE_IC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#B8F25B"/><path d="M7 12.5l3.2 3.2L17 9" stroke="#0D0F0C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SPIN_IC = '<svg class="spin" width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#2A2F27" stroke-width="3"/><path d="M21 12a9 9 0 0 0-9-9" stroke="#B8F25B" stroke-width="3" stroke-linecap="round"/></svg>';
const WAIT_IC = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#2A2F27" stroke-width="2"/></svg>';
const runId = Live.store.get('runId');
let timer = null;
let pathReady = false;

$('feed').innerHTML = STEPS.map((step) => `<li><span class="ico"></span><span class="label">${step.label}</span><span class="count"></span></li>`).join('');
const rows = [...$('feed').children];
$('next').href = Live.href('paths.html');
document.querySelectorAll('[data-icon]').forEach((element) => { element.innerHTML = ICON[element.dataset.icon]; });

async function showCompanies() {
  try {
    const companies = await Live.api('GET', '/v1/research-runs/' + runId + '/companies?pageSize=12');
    $('logos').innerHTML = companies.map((company) => `<div title="${esc(company.name)}">${esc(company.name.slice(0, 1).toUpperCase())}</div>`).join('');
  } catch (error) {
    Live.banner('Could not load the companies: ' + error.message, 'error');
  }
}

async function poll() {
  if (!runId) { $('headline').textContent = 'No research is running.'; $('reading').textContent = 'Start from the interview.'; return; }
  try {
    const run = await Live.api('GET', '/v1/research-runs/' + runId);
    const byStep = Object.fromEntries((run.progress || []).map((progress) => [progress.step, progress]));
    rows.forEach((row, i) => {
      const step = STEPS[i]; const progress = byStep[step.key];
      const done = run.status === 'done' || !!(progress && progress.total > 0 && progress.done >= progress.total);
      const active = !done && !!progress;
      row.className = done ? 'done' : active ? 'active' : '';
      row.querySelector('.ico').innerHTML = done ? DONE_IC : active ? SPIN_IC : WAIT_IC;
      row.querySelector('.count').textContent = progress && progress.total ? `${progress.done} / ${progress.total} ${step.unit}` : '';
    });
    if (!pathReady) {
      const paths = await Live.api('GET', '/v1/research-runs/' + runId + '/career-paths').catch(() => null);
      pathReady = Array.isArray(paths);
      $('next').hidden = !pathReady;
    }
    if (run.status === 'failed' || run.status === 'cancelled') {
      $('headline').textContent = 'The research stopped.';
      $('reading').textContent = run.error?.message || ('Status: ' + run.status);
      Live.banner($('reading').textContent, 'error');
      return;
    }
    if (run.status === 'done') {
      $('headline').textContent = 'Done. Here is what the market says.';
      $('reading').textContent = 'The research is ready. You can explore the paths in the API’s order.';
      await showCompanies();
      return;
    }
    $('headline').textContent = pathReady ? 'Your paths are ready. Still checking the details…' : 'Researching the job market for you…';
    const active = (run.progress || []).find((progress) => progress.done < progress.total);
    $('reading').textContent = active ? (STEPS.find((step) => step.key === active.step)?.label || active.step) : ('Status: ' + run.status);
    timer = setTimeout(poll, 2500);
  } catch (error) {
    Live.banner('Could not refresh the research: ' + error.message, 'error');
    timer = setTimeout(poll, 4000);
  }
}

window.addEventListener('beforeunload', () => clearTimeout(timer));
poll();
