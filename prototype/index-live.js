const $ = (id) => document.getElementById(id);
const PHASES = ['mode', 'chat', 'bridge', 'cards', 'practical', 'finalChat', 'cv'];
const PRACTICAL = {
  place: [
    { label: 'Prague', value: [{ country: 'CZ', city: 'Prague' }] },
    { label: 'Anywhere in Czechia', value: [{ country: 'CZ' }] },
    { label: 'Other country…', custom: true },
  ],
  remote: [{ label: 'Remote only', value: 'only' }, { label: 'Remote is fine', value: 'ok' }, { label: 'On-site', value: 'no' }],
  hours: [{ label: 'Under 5h', value: 'under-5' }, { label: '5 to 10h', value: '5-10' }, { label: '10 to 20h', value: '10-20' }, { label: 'Full time', value: 'full-time' }],
  budget: [{ label: 'Free only', value: 'free-only' }, { label: 'A little', value: 'some' }, { label: 'Happy to invest', value: 'any' }],
  education: [{ label: 'No formal qualification', value: 'none' }, { label: 'Secondary school', value: 'secondary' }, { label: 'Vocational', value: 'vocational' }, { label: "Bachelor's", value: 'bachelor' }, { label: "Master's or higher", value: 'master-or-higher' }],
};
const state = { intake: null, phase: 'mode', practical: {}, languages: [], dream: [], noDream: false, links: [], documentId: null, busy: false };
let seekerId = null;
let currentCard = null;
let voice = false;
let recognition = null;
let recorder = null;
let recordingStream = null;
let audio = null;
let chatOpened = false;

function show(phase) {
  state.phase = phase;
  PHASES.forEach((name) => { $(name + 'Phase').hidden = name !== phase; });
  if (phase === 'chat') renderWarmup();
  if (phase === 'cards') showCard();
  if (phase === 'practical') renderPractical();
  if (phase === 'finalChat') openFinalChat();
  if (phase === 'cv') say('Last one, and it’s optional. Add a CV or a link, or just move on.');
  renderSide();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function agentMessage(target, text, sources) {
  const d = document.createElement('div');
  d.className = 'msg-agent new';
  const links = (sources || []).filter((s) => s.url).map((s) => ` <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || 'Source')}</a>`).join('');
  d.innerHTML = '<div class="avatar">' + LOGO.replace('width="28" height="28"', 'width="18" height="18"') + '</div><p>' + esc(text).replace(/\n/g, '<br>') + links + '</p>';
  $(target).appendChild(d);
}

function meMessage(target, text) {
  const d = document.createElement('div');
  d.className = 'msg-me';
  d.textContent = text;
  $(target).appendChild(d);
}

function currentQuestion() {
  const key = state.intake?.warmup.currentKey;
  return state.intake?.warmup.questions.find((q) => q.key === key);
}

function renderWarmup() {
  const q = currentQuestion();
  $('chat').innerHTML = '';
  (state.intake?.warmup.answers || []).forEach((answer) => {
    meMessage('chat', answer.answer);
    if (answer.reply) agentMessage('chat', answer.reply);
  });
  if (q) agentMessage('chat', q.text);
  $('bubbles').innerHTML = '';
  (q?.options || []).forEach((label, i) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'bubble'; button.style.animationDelay = (i * .05) + 's'; button.textContent = label;
    button.onclick = () => answerWarmup(label);
    $('bubbles').appendChild(button);
  });
  $('own').hidden = !q || state.busy;
  if (q) say(q.text);
}

async function answerWarmup(text) {
  const q = currentQuestion();
  text = text.trim();
  if (!q || !text || state.busy) return;
  stopListening();
  state.busy = true; $('typing').hidden = false; $('own').hidden = true;
  try {
    const previousPhase = state.intake.phase;
    state.intake = await Live.api('POST', '/v1/seekers/' + seekerId + '/intake/warmup', { questionKey: q.key, answer: text });
    renderSide();
    if (previousPhase === 'warmup' && state.intake.phase === 'cards') show('bridge');
    else renderWarmup();
  } catch (error) {
    Live.banner('Could not save that answer: ' + error.message, 'error');
  } finally {
    state.busy = false; $('typing').hidden = true;
  }
}

function showCard() {
  currentCard = state.intake?.cards.current;
  if (!currentCard) return show('practical');
  $('taskWrap').classList.remove('advance');
  $('taskWrap').innerHTML = `<div class="ghost-card g2"></div><div class="ghost-card g1"></div><div class="task from-stack" id="task"><div class="src"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>From a real job ad</div><div class="text">${esc(currentCard.text)}</div><div class="reveal" id="reveal"></div></div>`;
  say(currentCard.text + ' Would you enjoy that?');
}

async function rate(kind) {
  if (state.busy || !currentCard) return;
  state.busy = true; stopListening();
  const ratedId = currentCard.cardId;
  try {
    const next = await Live.api('POST', '/v1/seekers/' + seekerId + '/intake/cards/' + encodeURIComponent(ratedId) + '/rating', { rating: kind });
    const rated = next.cards.rated.find((item) => item.card.cardId === ratedId);
    const reveal = rated ? 'That’s a ' + rated.card.occupation.label + ' task.' : 'Thanks — saved.';
    $('reveal').innerHTML = rated?.card.source.url ? `${esc(reveal)} <a href="${esc(rated.card.source.url)}" target="_blank" rel="noopener">Source</a>` : esc(reveal);
    $('task').classList.add('tint-' + kind);
    $('task').style.setProperty('--tilt', { like: '4deg', no: '-4deg', maybe: '0deg' }[kind]);
    state.intake = next; renderSide();
    const advance = () => {
      $('task').classList.add('out-down'); $('taskWrap').classList.add('advance');
      setTimeout(() => { state.busy = false; state.intake.cards.done ? show('practical') : showCard(); }, 420);
    };
    if (voice) say(reveal, advance); else setTimeout(advance, 650);
  } catch (error) {
    state.busy = false;
    Live.banner('Could not save that reaction: ' + error.message, 'error');
  }
}

function valueLabel(group, value) {
  return PRACTICAL[group].find((option) => JSON.stringify(option.value) === JSON.stringify(value))?.label || (group === 'place' && value?.[0] ? [value[0].city, value[0].country].filter(Boolean).join(', ') : '');
}

function renderPractical() {
  if (state.intake?.practical && !Object.keys(state.practical).length) {
    const p = state.intake.practical;
    state.practical = { place: p.locations, remote: p.remote, hours: p.hoursPerWeek, budget: p.courseBudget, education: p.education };
    state.languages = p.languages.slice(); state.dream = p.dreamCompanies.slice(); state.noDream = p.dreamCompanies.length === 0;
  }
  document.querySelectorAll('[data-group]').forEach((group) => {
    const key = group.dataset.group;
    group.innerHTML = PRACTICAL[key].map((option, i) => `<button type="button" class="bubble no-anim" data-i="${i}">${esc(option.label)}</button>`).join('');
    group.querySelectorAll('button').forEach((button) => button.onclick = () => {
      const option = PRACTICAL[key][Number(button.dataset.i)];
      if (option.custom) {
        const country = prompt('Two-letter country code (for example DE or GB)')?.trim().toUpperCase();
        if (!country || !/^[A-Z]{2}$/.test(country)) return;
        const city = prompt('City (optional)')?.trim();
        state.practical[key] = [{ country, ...(city ? { city } : {}) }];
      } else state.practical[key] = structuredClone(option.value);
      updatePractical(); renderSide();
    });
  });
  $('langCode').value ||= state.practical.place?.[0]?.country === 'CZ' ? 'cs' : '';
  renderLanguages(); renderDream(); updatePractical();
}

function renderLanguages() {
  $('langs').innerHTML = state.languages.map((language, i) => `<span class="chip">${esc(language.lang)} · ${esc(language.level)} <button type="button" class="icon-btn" data-lang-i="${i}" aria-label="Remove language" style="width:20px;height:20px">${ICON.x}</button></span>`).join('');
  $('langs').querySelectorAll('[data-lang-i]').forEach((button) => button.onclick = () => { state.languages.splice(Number(button.dataset.langI), 1); renderLanguages(); updatePractical(); renderSide(); });
}

function renderDream() {
  $('dream').innerHTML = state.dream.map((company, i) => `<span class="chip">${esc(company.name)} <button type="button" class="icon-btn" data-dream-i="${i}" aria-label="Remove ${esc(company.name)}" style="width:20px;height:20px">${ICON.x}</button></span>`).join('') + `<button type="button" class="bubble no-anim ${state.noDream ? 'on' : ''}" id="noDream">None yet</button>`;
  $('dream').querySelectorAll('[data-dream-i]').forEach((button) => button.onclick = () => { state.dream.splice(Number(button.dataset.dreamI), 1); renderDream(); updatePractical(); renderSide(); });
  $('noDream').onclick = () => { state.noDream = !state.noDream; if (state.noDream) state.dream = []; renderDream(); updatePractical(); renderSide(); };
}

function updatePractical() {
  document.querySelectorAll('[data-group]').forEach((group) => group.querySelectorAll('button').forEach((button) => {
    const option = PRACTICAL[group.dataset.group][Number(button.dataset.i)];
    button.classList.toggle('on', !option.custom && JSON.stringify(option.value) === JSON.stringify(state.practical[group.dataset.group]));
  }));
  const ready = ['place', 'remote', 'hours', 'budget', 'education'].every((key) => state.practical[key] !== undefined) && state.languages.length > 0 && (state.dream.length > 0 || state.noDream);
  $('practicalDone').disabled = !ready; $('practicalDone').style.opacity = ready ? 1 : .4;
}

async function savePractical() {
  if ($('practicalDone').disabled) return;
  try {
    state.intake = await Live.api('PUT', '/v1/seekers/' + seekerId + '/intake/practical', {
      locations: state.practical.place,
      remote: state.practical.remote,
      hoursPerWeek: state.practical.hours,
      courseBudget: state.practical.budget,
      education: state.practical.education,
      languages: state.languages,
      dreamCompanies: state.noDream ? [] : state.dream,
    });
    show(state.intake.phase === 'chat' ? 'finalChat' : 'cv');
  } catch (error) {
    Live.banner('Could not save the practical details: ' + error.message, 'error');
  }
}

async function openFinalChat() {
  if (chatOpened) return;
  chatOpened = true; state.busy = true; $('finalTyping').hidden = false;
  try {
    const response = await Live.api('POST', '/v1/seekers/' + seekerId + '/interview/messages', { text: '' });
    agentMessage('finalChat', response.reply, response.sources);
    if (response.done) show('cv'); else say(response.reply);
  } catch (error) {
    Live.banner('Could not reach the interviewer: ' + error.message, 'error');
  } finally { state.busy = false; $('finalTyping').hidden = true; }
}

async function finalTurn(text) {
  text = text.trim(); if (!text || state.busy) return;
  meMessage('finalChat', text); state.busy = true; $('finalTyping').hidden = false; stopListening();
  try {
    const response = await Live.api('POST', '/v1/seekers/' + seekerId + '/interview/messages', { text });
    agentMessage('finalChat', response.reply, response.sources);
    if (response.done) setTimeout(() => show('cv'), 500); else say(response.reply);
  } catch (error) { Live.banner('Could not save that message: ' + error.message, 'error'); }
  finally { state.busy = false; $('finalTyping').hidden = true; }
}

async function skipFinalChat() {
  try { state.intake = await Live.api('POST', '/v1/seekers/' + seekerId + '/intake/chat/skip'); show('cv'); }
  catch (error) { Live.banner('Could not skip this step: ' + error.message, 'error'); }
}

async function upload(file) {
  $('drop').hidden = true; $('fileCard').hidden = false; $('fileName').textContent = file.name; $('scanText').textContent = 'Reading your CV…'; $('skills').innerHTML = '';
  try {
    const form = new FormData(); form.append('file', file);
    const uploaded = await Live.api('POST', '/v1/seekers/' + seekerId + '/documents', form);
    state.documentId = uploaded.id;
    (uploaded.statedSkills || []).forEach((claim) => { const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = (claim.skill && claim.skill.label) || claim.statement; $('skills').appendChild(chip); });
    $('scanText').textContent = uploaded.statedSkills?.length ? 'Skills found in your CV.' : 'We read it, but found no skills to add.';
  } catch (error) { $('scanText').textContent = 'Could not read this file.'; Live.banner('Could not upload the file: ' + error.message, 'error'); }
}

function linkKind(url) {
  if (/github\.com|gitlab\.com/i.test(url)) return 'github';
  if (/linkedin\.com/i.test(url)) return 'linkedin';
  if (/behance|dribbble|portfolio/i.test(url)) return 'portfolio';
  if (/instagram|tiktok|youtube|soundcloud|x\.com|twitter|facebook/i.test(url)) return 'social';
  return 'other';
}

function renderLinks() {
  $('links').innerHTML = state.links.map((url, i) => `<div class="link-row"><span style="flex:1;font-size:15px">${esc(url)}</span><button class="icon-btn" type="button" data-link-i="${i}" aria-label="Remove link">${ICON.x}</button></div>`).join('');
  $('links').querySelectorAll('[data-link-i]').forEach((button) => button.onclick = () => { state.links.splice(Number(button.dataset.linkI), 1); renderLinks(); renderSide(); });
}

async function finish() {
  setVoice(false);
  try {
    await Live.api('PUT', '/v1/seekers/' + seekerId + '/links', { links: state.links.map((url) => ({ url, kind: linkKind(url) })) });
    const profile = await Live.api('GET', '/v1/seekers/' + seekerId + '/profile');
    if (profile.status !== 'complete') throw new Error('The guided intake is not complete yet');
    const run = await Live.api('POST', '/v1/research-runs', { profile, options: { nameSearch: profile.consent.nameSearch } });
    Live.store.set('runId', run.runId);
    Live.store.set('validationId', null);
    Live.store.set('roadmapId', null);
    Live.store.set('chapterId', null);
    location.href = Live.href('research.html');
  } catch (error) { Live.banner('Could not start the research: ' + error.message, 'error'); }
}

function renderFacts() {
  const facts = [];
  (state.intake?.warmup.answers || []).forEach((answer) => facts.push(answer.answer));
  if (state.intake?.paths?.length) state.intake.paths.filter((path) => path.top3).slice(0, 3).forEach((path) => facts.push(path.occupation.label));
  Object.entries(state.practical).forEach(([key, value]) => facts.push(valueLabel(key, value)));
  state.languages.forEach((language) => facts.push(language.lang + ' · ' + language.level));
  state.dream.forEach((company) => facts.push(company.name));
  state.links.forEach((url) => facts.push(url));
  $('facts').innerHTML = facts.filter(Boolean).map((fact) => `<span class="chip" style="font-size:13px;padding:5px 10px">${esc(fact)}</span>`).join('') || '<span class="chip-empty" style="font-size:13px;padding:4px 10px">Nothing yet</span>';
}

function renderExpect() {
  const labels = { mode: 'Choose how to answer', chat: 'Warm up', bridge: 'Task cards next', cards: 'Task cards', practical: 'Practical details', finalChat: 'Anything else', cv: 'Optional CV and links' };
  const rated = state.intake?.cards.rated.length || 0;
  $('expectNote').textContent = state.phase === 'cards' ? (state.intake?.cards.done ? 'Cards complete' : (rated ? 'Keep going — the next card is ready' : 'First task')) : labels[state.phase];
  const order = ['mode', 'chat', 'bridge', 'cards', 'practical', 'finalChat', 'cv'];
  const pill = document.querySelector('.stepbar a.on');
  if (pill) {
    const pct = Math.round((order.indexOf(state.phase) / (order.length - 1)) * 100);
    pill.innerHTML = pill.querySelector('svg').outerHTML + '<span>Interview</span><span class="sub">· ' + esc(labels[state.phase]) + '</span><span class="fill" style="width:' + pct + '%"></span>';
  }
}

function renderMap() {
  const paths = state.intake?.paths || [];
  const rated = state.intake?.cards.rated || [];
  $('map').innerHTML = '';
  const ns = 'http://www.w3.org/2000/svg';
  const you = document.createElementNS(ns, 'g'); you.setAttribute('transform', 'translate(164,150)'); you.innerHTML = '<circle r="9" fill="#0D0F0C" stroke="#B8F25B" stroke-width="2.5"></circle><text text-anchor="middle" dy="24">You</text>'; $('map').appendChild(you);
  paths.slice(0, 8).forEach((path, i) => {
    const angle = (i / Math.max(paths.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const distance = path.top3 ? 78 + i * 9 : 128;
    const x = 164 + Math.cos(angle) * distance, y = 150 + Math.sin(angle) * distance;
    const line = document.createElementNS(ns, 'line'); line.setAttribute('x1', '164'); line.setAttribute('y1', '150'); line.setAttribute('x2', x); line.setAttribute('y2', y); line.setAttribute('class', 'lnk path'); $('map').insertBefore(line, you);
    const g = document.createElementNS(ns, 'g'); g.setAttribute('transform', `translate(${x},${y})`); g.innerHTML = `<circle class="nd" r="${path.top3 ? 9 : 6}" fill="${path.top3 ? '#B8F25B' : '#5A6452'}"></circle><text text-anchor="middle" dy="22">${esc(path.occupation.label)}</text>`; $('map').appendChild(g);
    rated.filter((item) => item.card.occupation.uri === path.occupation.uri).slice(0, 5).forEach((item, j) => { const dot = document.createElementNS(ns, 'circle'); dot.setAttribute('cx', x + 15 + j * 5); dot.setAttribute('cy', y - 12 + j * 3); dot.setAttribute('r', '3'); dot.setAttribute('fill', item.rating === 'like' ? '#D4FA92' : '#6F7869'); $('map').appendChild(dot); });
  });
}

function renderSide() { renderFacts(); renderExpect(); renderMap(); renderVoiceUI(); }

function setBar(mode, title, sub) {
  $('vbar').className = 'vbar ' + mode; $('vstate').textContent = title; $('vlive').textContent = sub || ''; $('vStatus').textContent = title;
  document.body.classList.remove('v-speaking', 'v-listening', 'v-idle'); document.body.classList.add('v-' + mode);
  if (mode === 'speaking') { $('vCaption').textContent = sub || ''; $('vTranscript').textContent = ''; }
  else $('vTranscript').textContent = sub || '';
}

function browserSpeech(text, then) {
  if (!('speechSynthesis' in window)) { then?.(); return; }
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.rate = 1.03;
  utterance.onend = () => { if (voice) then ? then() : listen(); };
  utterance.onerror = () => { if (voice) then?.(); };
  speechSynthesis.speak(utterance);
}

async function say(text, then) {
  if (!voice) return;
  stopListening(); if (audio) { audio.pause(); audio = null; }
  setBar('speaking', 'Speaking', text);
  if (Live.sample) return browserSpeech(text, then);
  try {
    const response = await fetch('/ui/api/v1/voice/speech', { method: 'POST', headers: { 'X-Ethera-UI': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 600) }) });
    if (!response.ok) throw new Error('speech unavailable');
    const url = URL.createObjectURL(await response.blob()); audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); audio = null; if (voice) then ? then() : listen(); };
    audio.onerror = () => { URL.revokeObjectURL(url); audio = null; browserSpeech(text, then); };
    await audio.play();
  } catch { browserSpeech(text, then); }
}

function listen() {
  if (!voice) return;
  stopListening();
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    let handled = false; recognition = new SpeechRecognition(); recognition.lang = navigator.language || 'en-US'; recognition.interimResults = true;
    recognition.onresult = (event) => { const result = event.results[event.results.length - 1]; const text = result[0].transcript; setBar('listening', 'Listening…', '“' + text + '”'); if (result.isFinal) { handled = true; recognition = null; handleVoice(text); } };
    recognition.onerror = () => {};
    recognition.onend = () => { if (!handled && voice) setBar('idle', 'Didn’t catch that', 'Tap the mic to try again, or tap an answer'); };
    setBar('listening', 'Listening…', 'Say it in your own words');
    try { recognition.start(); } catch {}
    return;
  }
  startRecording();
}

async function startRecording() {
  if (!navigator.mediaDevices || !window.MediaRecorder) { setBar('idle', 'Microphone unavailable', 'Tap or type your answer instead'); return; }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = []; recorder = new MediaRecorder(recordingStream);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      const type = recorder.mimeType || 'audio/webm'; recorder = null; recordingStream.getTracks().forEach((track) => track.stop()); recordingStream = null;
      setBar('idle', 'Transcribing…', 'One moment');
      try { const form = new FormData(); form.append('file', new Blob(chunks, { type }), 'answer.webm'); const result = await Live.api('POST', '/v1/voice/transcribe', form); handleVoice(result.text); }
      catch (error) { Live.banner('Could not transcribe that recording: ' + error.message, 'error'); setBar('idle', 'Try again', 'Or tap or type your answer'); }
    };
    recorder.start(); setBar('listening', 'Recording…', 'Tap the mic when you’re done');
  } catch { setBar('idle', 'Microphone unavailable', 'Allow microphone access, or tap an answer'); }
}

function stopListening() {
  if (recognition) { const active = recognition; recognition = null; active.onend = null; try { active.abort(); } catch {} }
  if (recorder && recorder.state === 'recording') recorder.stop();
}

function handleVoice(text) {
  const lower = text.toLowerCase();
  if (state.phase === 'chat') return answerWarmup(text);
  if (state.phase === 'bridge') return /yes|ready|go|start|sure|ok/.test(lower) ? show('cards') : say('Just say ready when you are.');
  if (state.phase === 'cards') {
    if (/maybe|not sure|depends/.test(lower)) return rate('maybe');
    if (/\bno\b|not for me|nope|wouldn'?t/.test(lower)) return rate('no');
    if (/yes|love|enjoy|sure|would|interesting/.test(lower)) return rate('like');
    return say('Was that a yes, a no, or a maybe?');
  }
  if (state.phase === 'finalChat') return finalTurn(text);
  if (state.phase === 'cv' && /skip|nothing|research|done|next|go/.test(lower)) return finish();
  say('You can tap the choices here, or switch to tapping mode.');
}

function setVoice(enabled) {
  voice = enabled;
  if (!voice) { if (audio) audio.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); stopListening(); document.body.classList.remove('v-speaking', 'v-listening', 'v-idle'); }
  renderVoiceUI();
}

function renderVoiceUI() {
  const inFlow = state.phase !== 'mode'; const enabled = voice && inFlow;
  $('vbar').hidden = !enabled; $('voiceOn').hidden = voice || !inFlow; document.body.classList.toggle('voice-mode', enabled);
  if (!enabled) return;
  $('vStep').textContent = $('expectNote').textContent; $('vFacts').innerHTML = $('facts').innerHTML;
}

async function loadIntake(more) {
  try {
    seekerId = await Live.seeker();
    state.intake = await Live.api('GET', '/v1/seekers/' + seekerId + '/intake');
    if (more) state.intake = await Live.api('POST', '/v1/seekers/' + seekerId + '/intake/cards/more');
    if (state.intake.phase === 'warmup') show('chat');
    else if (state.intake.phase === 'cards') show(more || state.intake.cards.rated.length ? 'cards' : 'bridge');
    else if (state.intake.phase === 'practical') show('practical');
    else if (state.intake.phase === 'chat') show('finalChat');
    else show('cv');
  } catch (error) { Live.banner('Could not load the interview: ' + error.message, 'error'); }
}

document.querySelectorAll('[data-mode]').forEach((button) => button.onclick = () => { setVoice(button.dataset.mode === 'voice'); loadIntake(false); });
document.querySelectorAll('[data-rate]').forEach((button) => button.onclick = () => rate(button.dataset.rate));
document.querySelectorAll('[data-finish]').forEach((button) => button.onclick = finish);
document.querySelectorAll('[data-icon]').forEach((element) => { element.innerHTML = ICON[element.dataset.icon]; });
$('startCards').onclick = () => show('cards');
$('practicalDone').onclick = savePractical;
$('skipChat').onclick = skipFinalChat;
$('own').onsubmit = (event) => { event.preventDefault(); const text = $('ownInput').value; $('ownInput').value = ''; answerWarmup(text); };
$('finalOwn').onsubmit = (event) => { event.preventDefault(); const text = $('finalInput').value; $('finalInput').value = ''; finalTurn(text); };
$('langForm').onsubmit = (event) => { event.preventDefault(); const lang = $('langCode').value.trim().toLowerCase(); if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang)) return Live.banner('Use a language code such as cs, en or de.', 'error'); const value = { lang, level: $('langLevel').value }; const existing = state.languages.findIndex((item) => item.lang === lang); if (existing >= 0) state.languages[existing] = value; else state.languages.push(value); $('langCode').value = ''; renderLanguages(); updatePractical(); renderSide(); };
$('dreamForm').onsubmit = (event) => { event.preventDefault(); const name = $('dreamInput').value.trim(); if (name && !state.dream.some((company) => company.name === name)) state.dream.push({ name }); state.noDream = false; $('dreamInput').value = ''; renderDream(); updatePractical(); renderSide(); };
$('linkForm').onsubmit = (event) => { event.preventDefault(); let url = $('link').value.trim(); if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url; try { if (url) new URL(url); } catch { return Live.banner('Enter a full web link.', 'error'); } if (url && !state.links.includes(url)) state.links.push(url); $('link').value = ''; renderLinks(); renderSide(); };
$('file').onchange = (event) => { if (event.target.files[0]) upload(event.target.files[0]); };
['dragover', 'dragenter'].forEach((name) => $('drop').addEventListener(name, (event) => { event.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach((name) => $('drop').addEventListener(name, (event) => { event.preventDefault(); $('drop').classList.remove('over'); }));
$('drop').addEventListener('drop', (event) => { if (event.dataTransfer.files[0]) upload(event.dataTransfer.files[0]); });
$('removeCv').innerHTML = ICON.x;
$('removeCv').onclick = async () => { $('drop').hidden = false; $('fileCard').hidden = true; $('file').value = ''; if (state.documentId) { try { await Live.api('DELETE', '/v1/seekers/' + seekerId + '/documents/' + state.documentId); } catch (error) { Live.banner('Could not remove the document: ' + error.message, 'error'); } state.documentId = null; } };
$('voiceOff').onclick = () => setVoice(false);
$('voiceOn').onclick = () => { setVoice(true); if (state.phase === 'chat') say(currentQuestion()?.text || 'Tell me in your own words.'); else if (state.phase === 'cards' && currentCard) say(currentCard.text + ' Would you enjoy that?'); else listen(); };
$('micBtn').onclick = () => { if (recorder?.state === 'recording') recorder.stop(); else { if (audio) audio.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); listen(); } };
$('ccBtn').onclick = () => { const on = $('ccBtn').getAttribute('aria-pressed') !== 'true'; $('ccBtn').setAttribute('aria-pressed', String(on)); $('vCaption').hidden = !on; };
document.addEventListener('keydown', (event) => { if (state.phase !== 'cards') return; const kind = { ArrowLeft: 'no', ArrowDown: 'maybe', ArrowRight: 'like' }[event.key]; if (kind) { event.preventDefault(); rate(kind); } });

const minimap = $('minimap'); let mapPinned = false; let mapTimer;
const setMapOpen = (open) => { minimap.classList.toggle('open', open); minimap.setAttribute('aria-expanded', String(open)); };
minimap.addEventListener('mouseenter', () => { clearTimeout(mapTimer); mapTimer = setTimeout(() => setMapOpen(true), 140); });
minimap.addEventListener('mouseleave', () => { clearTimeout(mapTimer); if (!mapPinned) mapTimer = setTimeout(() => setMapOpen(false), 260); });
minimap.addEventListener('click', () => { mapPinned = !mapPinned; setMapOpen(mapPinned); });

show('mode');
if (new URLSearchParams(location.search).has('more')) { setVoice(false); loadIntake(true); }
