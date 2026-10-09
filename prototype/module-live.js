const $ = (id) => document.getElementById(id);
const roadmapId = Live.store.get('roadmapId');
const requestedId = new URLSearchParams(location.search).get('chapterId') || Live.store.get('chapterId');
let roadmap = null;
let module = null;
let chapter = null;
let profile = null;
let filter = 'Free first';

function sourceLink(source, label = 'Source') {
  return source?.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.title || label)}</a>` : '';
}

function resourceMarkup(resource, top = false) {
  const price = resource.cost === 'paid' ? (resource.price || 'Paid') : resource.cost;
  const tags = [price, resource.format, resource.level, resource.scope, resource.effortHours !== undefined ? `About ${resource.effortHours}h` : ''].filter(Boolean);
  return `<div class="res ${top ? 'top' : ''}"><a href="${esc(resource.url)}" target="_blank" rel="noopener" style="display:contents"><div class="ic">${esc(resource.format.slice(0, 2).toUpperCase())}</div><div class="meta"><div class="title">${esc(resource.title)}</div><div class="by">${esc(resource.provider)}</div><div class="tags">${tags.map((tag) => `<span class="tag ${resource.cost === 'free' ? 'free' : resource.cost === 'paid' ? 'paid' : ''}">${esc(String(tag))}</span>`).join('')}</div></div></a><span style="font-size:13px">${sourceLink(resource.source)}</span></div>`;
}

function allChapters() { return roadmap.modules.flatMap((item) => item.chapters); }
function isDone(item) { return Boolean(item.done || item.doneBy); }

function chapterTimeText() {
  const weekly = { 'under-5': 4, '5-10': 10, '10-20': 20, 'full-time': 40 }[profile?.preferences?.hoursPerWeek];
  const resource = chapter.resources.find((item) => item.resourceId === chapter.topPickId) || chapter.resources[0];
  if (!weekly || !Number.isFinite(resource?.effortHours)) return '';
  const weeks = Math.max(1, Math.ceil(resource.effortHours / weekly));
  return `About ${weeks} ${weeks === 1 ? 'week' : 'weeks'} at ${weekly}h a week`;
}

function renderResources() {
  const top = chapter.resources.find((resource) => resource.resourceId === chapter.topPickId) || chapter.resources[0];
  $('topResource').innerHTML = top ? resourceMarkup(top, true) : '<p class="hint">No verified starting resource is available.</p>';
  let others = chapter.resources.filter((resource) => resource !== top);
  if (filter === 'Free') others = others.filter((resource) => resource.cost === 'free');
  if (filter === 'Paid') others = others.filter((resource) => resource.cost === 'paid');
  if (filter === 'Free first') others.sort((a, b) => (a.cost === 'free' ? 0 : 1) - (b.cost === 'free' ? 0 : 1));
  $('list').innerHTML = others.map((resource) => resourceMarkup(resource)).join('') || '<p class="hint">No other verified resources match this filter.</p>';
  $('filters').innerHTML = ['Free first', 'Free', 'Paid'].map((name) => `<button class="seg ${name === filter ? 'on' : ''}" type="button" aria-pressed="${name === filter}">${name}</button>`).join('');
  $('filters').querySelectorAll('button').forEach((button) => button.onclick = () => { filter = button.textContent; renderResources(); });
}

function renderProgress() {
  const chapters = allChapters();
  const index = chapters.findIndex((item) => item.chapterId === chapter.chapterId);
  const done = chapters.filter(isDone).length;
  const chapterDone = isDone(chapter);
  const allComplete = chapters.length > 0 && done === chapters.length;
  const next = chapterDone ? chapters.find((item) => !isDone(item)) : chapters.slice(index + 1).find((item) => !isDone(item));
  $('markDone').disabled = false;
  $('markDone').innerHTML = chapterDone ? 'Un-tick this chapter' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>Mark as done';
  $('markDone').onclick = () => setProgress(!chapterDone);
  $('todo').querySelector('span').textContent = next ? 'Next up: ' + next.title : 'You can revisit any chapter from the roadmap.';
  $('todo').hidden = chapterDone;
  $('unlocked').hidden = !chapterDone;
  $('nextTitle').textContent = allComplete ? 'Roadmap complete' : next ? 'Unlocked: ' + next.title : 'Back to your roadmap';
  $('completionText').textContent = allComplete
    ? `Nice. That's ${done} of ${chapters.length}. Your roadmap is complete.`
    : next
    ? `Nice. That's ${done} of ${chapters.length}. Your next module is ready.`
    : `Nice. That's ${done} of ${chapters.length}. Choose any unfinished module next.`;
}

function render() {
  $('chapterTitle').textContent = chapter.title; document.title = 'Chapter: ' + chapter.title;
  const sectionIndex = roadmap.modules.findIndex((item) => item.moduleId === module.moduleId);
  const chapterIndex = module.chapters.findIndex((item) => item.chapterId === chapter.chapterId);
  $('moduleMeta').textContent = `Section ${sectionIndex + 1} · ${module.title} · Module ${chapterIndex + 1} of ${module.chapters.length}`;
  $('outcome').textContent = chapter.outcome;
  $('skillsMeta').textContent = chapter.skills.length ? chapter.skills.map((skill) => skill.label).join(' · ') : chapter.category;
  $('skillsMeta').hidden = !$('skillsMeta').textContent;
  $('effortMeta').textContent = chapterTimeText();
  const demand = chapter.demand;
  const evidenceSources = (chapter.claims || []).flatMap((claim) => claim.sources || []).map((source) => sourceLink(source)).filter(Boolean).join(' · ');
  $('whyRow').innerHTML = `<span class="lbl">Why this matters</span><span style="font-size:16px">${demand ? `<b style="color:var(--accent-hover)">${demand.vacanciesRequiring} of ${demand.vacanciesTotal}</b> current ads ask for these skills` : esc(module.why)}</span>${demand ? (demand.sources || []).map((source) => sourceLink(source)).filter(Boolean).join(' · ') : ''}${evidenceSources ? `<span class="hint">Your evidence: ${evidenceSources}</span>` : ''}`;
  $('heroTile').innerHTML = tile(isDone(chapter) ? 'done' : 'current', isDone(chapter) ? '✓' : 'logo', 96, 80);
  renderResources(); renderProgress();
}

async function setProgress(done) {
  $('markDone').disabled = true;
  try {
    chapter = await Live.api('PUT', '/v1/roadmaps/' + roadmapId + '/chapters/' + chapter.chapterId + '/progress', { done });
    const position = module.chapters.findIndex((item) => item.chapterId === chapter.chapterId); module.chapters[position] = chapter;
    render(); Live.banner(done ? 'Chapter marked done.' : 'Chapter put back on your roadmap.');
  } catch (error) { $('markDone').disabled = false; Live.banner('Could not update the chapter: ' + error.message, 'error'); }
}

async function load() {
  if (!roadmapId || !requestedId) { Live.banner('Open a chapter from your roadmap first.', 'error'); return; }
  try {
    const seekerId = await Live.seeker();
    [roadmap, profile] = await Promise.all([
      Live.api('GET', '/v1/roadmaps/' + roadmapId),
      Live.api('GET', '/v1/seekers/' + seekerId + '/profile'),
    ]);
    module = roadmap.modules.find((item) => item.chapters.some((candidate) => candidate.chapterId === requestedId));
    chapter = module?.chapters.find((candidate) => candidate.chapterId === requestedId);
    if (!chapter) throw new Error('This chapter is not in the stored roadmap');
    Live.store.set('chapterId', chapter.chapterId); render();
  } catch (error) { Live.banner('Could not load the chapter: ' + error.message, 'error'); }
}

document.querySelector('a[href="roadmap.html"]').href = Live.href('roadmap.html');
document.querySelectorAll('[data-icon]').forEach((element) => { element.innerHTML = ICON[element.dataset.icon]; });
$('nextTile').innerHTML = tile('current', 'logo', 60, 50);
load();
