const $ = (id) => document.getElementById(id);
const validationId = Live.store.get('validationId');
let roadmap = null;
let profile = null;
let pollTimer = null;

function sources(list) {
  return (list || []).filter((source) => source.url).map((source) => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title || 'Source')}</a>`).join(' · ');
}

function claimSources(claims) {
  return sources((claims || []).flatMap((claim) => claim.sources || []));
}

function resourceCard(resource, topPickId) {
  const tags = [resource.cost === 'paid' ? (resource.price || 'Paid') : resource.cost, resource.format, resource.level, resource.effortHours !== undefined ? `About ${resource.effortHours}h` : '', resource.scope].filter(Boolean);
  return `<div class="res ${resource.resourceId === topPickId ? 'top' : ''}"><a class="meta" href="${esc(resource.url)}" target="_blank" rel="noopener"><div class="title">${esc(resource.title)}</div><div class="by">${esc(resource.provider)}</div><div class="tags">${tags.map((tag) => `<span class="tag ${resource.cost === 'free' ? 'free' : resource.cost === 'paid' ? 'paid' : ''}">${esc(String(tag))}</span>`).join('')}</div></a><span style="font-size:13px">${resource.source?.url ? `<a href="${esc(resource.source.url)}" target="_blank" rel="noopener">Source</a>` : ''}</span></div>`;
}

function allChapters() { return roadmap.modules.flatMap((module) => module.chapters); }
function isDone(chapter) { return Boolean(chapter.done || chapter.doneBy); }
function nextChapter() { return allChapters().find((chapter) => !isDone(chapter)); }

function selectedEffortHours(chapter) {
  const resource = chapter.resources.find((item) => item.resourceId === chapter.topPickId) || chapter.resources[0];
  return Number.isFinite(resource?.effortHours) ? resource.effortHours : null;
}

function remainingTimeText(chapters) {
  const weekly = { 'under-5': 4, '5-10': 10, '10-20': 20, 'full-time': 40 }[profile?.preferences?.hoursPerWeek];
  const remaining = chapters.filter((chapter) => !isDone(chapter));
  if (!weekly || !remaining.length) return '';
  const hours = remaining.map(selectedEffortHours);
  if (hours.some((value) => value === null)) return '';
  const weeks = Math.max(1, Math.ceil(hours.reduce((sum, value) => sum + value, 0) / weekly));
  if (weeks < 8) return `about ${weeks} ${weeks === 1 ? 'week' : 'weeks'} at ${weekly}h a week`;
  const months = Math.max(1, Math.round(weeks / 4.345));
  return `about ${months} ${months === 1 ? 'month' : 'months'} at ${weekly}h a week`;
}

function renderCompletedChapter() {
  const chapters = allChapters();
  const completed = chapters.find(isDone);
  $('doneRow').hidden = !completed;
  if (!completed) return;
  const sectionIndex = roadmap.modules.findIndex((module) => module.chapters.some((chapter) => chapter.chapterId === completed.chapterId));
  const section = roadmap.modules[sectionIndex];
  const details = [completed.title, completed.skills.map((skill) => skill.label).join(' · ')].filter(Boolean).join(' · ');
  $('doneTile').innerHTML = tile('done', '✓', 36, 30, 6);
  $('doneTitle').textContent = `Section ${sectionIndex + 1} · ${section.title}`;
  $('doneDetails').textContent = details;
  $('doneChip').textContent = completed.doneBy === 'evidence' ? "You've got this · from your profile" : 'Marked done by you';
  $('doneReview').href = Live.href('module.html?chapterId=' + encodeURIComponent(completed.chapterId));
}

function renderProgress() {
  const chapters = allChapters();
  const done = chapters.filter(isDone).length;
  const total = chapters.length;
  const time = remainingTimeText(chapters);
  $('dockProgress').textContent = `${done} of ${total} done`;
  $('dockText').textContent = `${done} of ${total} modules${time ? ' · ' + time : ''}`;
  $('progressBar').style.width = `${total ? (done / total) * 100 : 0}%`;
}

function renderTarget() {
  if (!roadmap.target) { $('target').innerHTML = ''; return; }
  const facts = roadmap.target.facts || [];
  $('target').innerHTML = `<div class="done-row"><span>${tile('current', 'logo', 50, 42, 5)}</span><div style="flex:1;min-width:220px"><div style="font-weight:600;font-size:16px;color:var(--muted)">Market entry point · ${esc(roadmap.target.step.title)}</div>${facts.map((claim) => `<div style="font-size:13px;color:var(--faint)">${esc(claim.statement)} ${claimSources([claim])}</div>`).join('')}</div></div>`;
}

function render() {
  $('occupation').textContent = roadmap.occupation.label;
  $('roadmapContext').textContent = roadmap.status === 'ready' ? 'A sourced path through the skills employers ask for' : 'Building your sourced roadmap…';
  renderTarget();
  renderCompletedChapter();
  renderProgress();
  const next = nextChapter();
  $('sections').innerHTML = roadmap.modules.map((module) => {
    const chapters = module.chapters;
    const height = Math.max(180, 60 + chapters.length * 150);
    const chapterMarkup = chapters.map((chapter, i) => {
      const isNext = next?.chapterId === chapter.chapterId;
      const chapterDone = isDone(chapter);
      const state = chapterDone ? 'done' : isNext ? 'current' : 'open';
      const left = i % 2 ? 460 : 180; const top = 36 + i * 145;
      const skills = chapter.skills.map((item) => item.label).join(' · ');
      const demand = chapter.demand ? `${chapter.demand.vacanciesRequiring} of ${chapter.demand.vacanciesTotal} current ads ask for this` : '';
      const query = 'module.html?chapterId=' + encodeURIComponent(chapter.chapterId);
      return `<div>
        <a class="node ${state}" data-chapter="${esc(chapter.chapterId)}" href="${Live.href(query)}" style="left:${left}px;top:${top}px" aria-label="Open ${esc(chapter.title)}">${isNext ? '<span class="here-pill">You start here</span>' : ''}${tile(state, chapterDone ? '✓' : 'logo')}</a>
        <div class="node-label" style="left:${i % 2 ? left + 134 : left - 214}px;top:${top + 16}px;width:200px;text-align:${i % 2 ? 'left' : 'right'}"><b>${esc(chapter.title)}</b><span>${esc([chapter.category, skills].filter(Boolean).join(' · '))}</span><button class="textlink" type="button" data-progress="${esc(chapter.chapterId)}" data-done="${chapterDone}">${chapterDone ? (chapter.doneBy === 'evidence' ? 'Already covered · un-tick' : 'Done · un-tick') : 'Mark as done'}</button></div>
      </div>`;
    }).join('');
    const wires = `<svg class="wire" width="760" height="${height}">${chapters.slice(0, -1).map((_, i) => { const ax = (i % 2 ? 460 : 180) + 60; const bx = ((i + 1) % 2 ? 460 : 180) + 60; const ay = 86 + i * 145; const by = 86 + (i + 1) * 145; return `<path d="M${ax} ${ay} C${ax} ${ay + 70},${bx} ${by - 70},${bx} ${by}" fill="none" stroke="#5C8F2A" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 8"/>`; }).join('')}</svg>`;
    const detail = chapters.map((chapter) => {
      const demand = chapter.demand ? `<p>${chapter.demand.vacanciesRequiring} of ${chapter.demand.vacanciesTotal} current ads ask for these skills. ${sources(chapter.demand.sources)}</p>` : '';
      const evidence = chapter.claims?.length ? `<p>You already shared evidence for this: ${claimSources(chapter.claims)}</p>` : '';
      return `<div class="panel" style="gap:12px"><div><span class="lbl">${esc(chapter.category)}</span><h3 style="font:600 21px var(--display);margin:6px 0">${esc(chapter.title)}</h3><p style="margin:0;color:var(--muted)">${esc(chapter.outcome)}</p></div>${chapter.skills.length ? `<div class="tags">${chapter.skills.map((item) => `<span class="tag">${esc(item.label)}</span>`).join('')}</div>` : ''}${demand}${evidence}<div style="display:flex;flex-direction:column;gap:10px">${chapter.resources.map((resource) => resourceCard(resource, chapter.topPickId)).join('') || '<span class="hint">No verified learning resource is available.</span>'}</div></div>`;
    }).join('');
    return `<section class="section ${next && chapters.some((chapter) => chapter.chapterId === next.chapterId) ? 'here' : ''}"><div class="section-head"><div><div class="kicker">Learning section</div><h2>${esc(module.title)}</h2><p>${esc(module.subtitle)} · ${esc(module.why)}</p></div></div><div class="map" style="width:760px;height:${height}px">${wires}${chapterMarkup}</div><div style="display:flex;flex-direction:column;gap:14px">${detail}</div></section>`;
  }).join('') || '<div class="panel">The roadmap is still being assembled.</div>';
  $('sections').querySelectorAll('[data-chapter]').forEach((link) => link.addEventListener('click', () => Live.store.set('chapterId', link.dataset.chapter)));
  $('sections').querySelectorAll('[data-progress]').forEach((button) => button.onclick = () => setProgress(button.dataset.progress, button.dataset.done !== 'true', button));
  $('legend').innerHTML = [['current', 'Up next'], ['open', 'Ready when you are'], ['done', 'Done or already covered']].map(([state, label]) => `<div>${tile(state, state === 'done' ? '✓' : undefined, 26, 22, 4)}${label}</div>`).join('');
}

async function setProgress(chapterId, done, button) {
  button.disabled = true;
  try {
    const updated = await Live.api('PUT', '/v1/roadmaps/' + roadmap.roadmapId + '/chapters/' + chapterId + '/progress', { done });
    for (const module of roadmap.modules) { const index = module.chapters.findIndex((chapter) => chapter.chapterId === chapterId); if (index >= 0) module.chapters[index] = updated; }
    render();
  } catch (error) { button.disabled = false; Live.banner('Could not update the chapter: ' + error.message, 'error'); }
}

async function poll() {
  try {
    roadmap = await Live.api('GET', '/v1/roadmaps/' + roadmap.roadmapId);
    render();
    if (roadmap.status === 'ready') return;
    if (roadmap.status === 'failed') { Live.banner(roadmap.error?.message || 'The roadmap build failed.', 'error'); return; }
    pollTimer = setTimeout(poll, 2500);
  } catch (error) { Live.banner('Could not refresh the roadmap: ' + error.message, 'error'); pollTimer = setTimeout(poll, 4000); }
}

async function load() {
  if (!validationId) { $('roadmapContext').textContent = 'Choose a path before building a roadmap.'; return; }
  try {
    const existingId = Live.store.get('roadmapId');
    const seekerId = await Live.seeker();
    if (existingId) {
      [roadmap, profile] = await Promise.all([
        Live.api('GET', '/v1/roadmaps/' + existingId),
        Live.api('GET', '/v1/seekers/' + seekerId + '/profile'),
      ]);
    }
    else {
      profile = await Live.api('GET', '/v1/seekers/' + seekerId + '/profile');
      roadmap = await Live.api('POST', '/v1/roadmaps', { validationId, profile });
      Live.store.set('roadmapId', roadmap.roadmapId);
    }
    render();
    if (roadmap.status !== 'ready') poll();
  } catch (error) { Live.banner('Could not build the roadmap: ' + error.message, 'error'); }
}

document.querySelector('a[href="paths.html"]').href = Live.href('paths.html');
const dock = $('infoDock'); let pinned = false; let timer;
const setDock = (open) => { dock.classList.toggle('open', open); dock.setAttribute('aria-expanded', String(open)); };
dock.addEventListener('mouseenter', () => { clearTimeout(timer); timer = setTimeout(() => setDock(true), 140); });
dock.addEventListener('mouseleave', () => { clearTimeout(timer); if (!pinned) timer = setTimeout(() => setDock(false), 260); });
dock.addEventListener('click', () => { pinned = !pinned; setDock(pinned); });
window.addEventListener('beforeunload', () => clearTimeout(pollTimer));
load();
