// Offline demo data. Every person, company and URL here is deliberately fictional.
const Sample = (() => {
  const source = (id, title, quote) => ({ id: 'src_SAMPLE_' + id, title, url: 'https://example.com/' + id, fetchedAt: '2026-01-01T00:00:00Z', tool: 'exa', quote, contentHash: 'fake-' + id });
  const occupation = (key, label) => ({ uri: 'urn:example:occupation:' + key, label, lang: 'en' });
  const skill = (key, label) => ({ uri: 'urn:example:skill:' + key, label, lang: 'en' });
  const OCC = [occupation('backend', 'Backend developer'), occupation('data', 'Data analyst'), occupation('qa', 'QA engineer')];
  const ALT = occupation('operations', 'Project coordinator');
  const cards = [
    ['crd_SAMPLE_1', 'Find out why an example website slows down every Monday, and fix it.', OCC[0]],
    ['crd_SAMPLE_2', 'Turn a messy example spreadsheet into a useful weekly report.', OCC[1]],
    ['crd_SAMPLE_3', 'Try to break an example signup flow before customers see it.', OCC[2]],
    ['crd_SAMPLE_4', 'Connect an example shop to a test payment provider.', OCC[0]],
  ].map(([cardId, text, job], i) => ({ cardId, text, occupation: job, related: [], source: source('fake-ad-' + i, 'Example job ad', String(text)) }));
  const extraCards = [
    ['crd_SAMPLE_EXTRA_1', 'Plan a fictional team event with a budget and timeline.'],
    ['crd_SAMPLE_EXTRA_2', 'Keep an example project on track and follow up on late work.'],
    ['crd_SAMPLE_EXTRA_3', 'Create a simple fictional system for incoming customer requests.'],
    ['crd_SAMPLE_EXTRA_4', 'Coordinate a pretend launch across three small teams.'],
  ].map(([cardId, text], i) => ({ cardId, text, occupation: ALT, related: [], source: source('fake-extra-ad-' + i, 'Example job ad', text) }));
  const allCards = [...cards, ...extraCards];
  const warmupQuestions = [
    { key: 'drawn', text: 'When you lose track of time, what are you usually doing?', options: ['Making things', 'Figuring out why something broke', 'Helping people'] },
    { key: 'with', text: 'Which sounds more like you?', options: ['Working with people', 'Building things', 'Working with information'] },
    { key: 'goal', text: 'What matters most to you right now?', options: ['Learn fast and grow', 'A stable job and salary', 'Work that means something'] },
  ];
  const newIntake = () => ({ seekerId: 'skr_SAMPLE_JANE_EXAMPLE', phase: 'warmup', warmup: { questions: warmupQuestions, answers: [], currentKey: 'drawn' }, cards: { current: undefined, rated: [], done: false }, paths: [], deck: { country: 'CZ', version: 'sample-1' } });
  let intake = newIntake();
  let extraRound = false;
  let activeExtraCards = [];
  let resumePhase = 'done';
  let runNumber = 0;
  let runPolls = sessionStorage.getItem('sampleRunDone') === '1' ? 3 : 0;
  const profile = {
    seekerId: 'skr_SAMPLE_JANE_EXAMPLE', profileVersion: 1, status: 'complete',
    consent: { dataProcessing: true, nameSearch: false, givenAt: '2026-01-01T00:00:00Z', policyVersion: 'sample' },
    preferences: { targetOccupations: OCC, locations: [{ country: 'CZ', city: 'Prague' }], remote: 'ok', goal: 'learn-fast', dreamCompanies: [{ name: 'Example Labs' }], dealBreakers: [], languages: [{ lang: 'en', level: 'working' }], hoursPerWeek: '5-10', courseBudget: 'free-only', education: 'secondary' },
    statedSkills: [{ id: 'clm_SAMPLE_1', statement: 'Jane Example has used spreadsheets.', kind: 'fact', subject: { type: 'seeker', id: 'skr_SAMPLE_JANE_EXAMPLE' }, skill: skill('spreadsheets', 'Spreadsheets'), confidence: 1, tier: 'stated', sources: [source('jane-example-cv', 'Jane Example CV', 'Used spreadsheets for a school project.')], createdAt: '2026-01-01T00:00:00Z' }],
    documents: [], links: [], updatedAt: '2026-01-01T00:00:00Z',
  };
  let paths = OCC.map((job, i) => ({
    occupation: job,
    why: [{ id: 'clm_SAMPLE_path_' + i, statement: i === 0 ? 'Example employers currently advertise this work in Prague.' : 'This path appears in the Example City sample market.', kind: 'fact', subject: { type: 'occupation', id: job.uri }, confidence: 1, tier: 'single-source', sources: [source('path-' + i, 'Example market page', 'Fictional sample demand evidence.')], createdAt: '2026-01-01T00:00:00Z' }],
    vacancyCount: [41, 24, 18][i],
    ladder: [
      { level: 'junior', title: 'Junior ' + job.label, salary: { median: 48000 + i * 2000, currency: 'CZK', period: 'month', sampleSize: 8, location: { country: 'CZ', city: 'Prague' } }, claims: [] },
      { level: 'mid', title: job.label, salary: { median: 68000 + i * 2000, currency: 'CZK', period: 'month', sampleSize: 6, location: { country: 'CZ', city: 'Prague' } }, claims: [] },
    ],
  }));
  const initialPaths = structuredClone(paths);
  const companies = [{ id: 'cmp_SAMPLE_1', name: 'Example Labs', country: 'CZ', registryIds: [], isDreamCompany: true, claims: [], ghostSignals: [] }, { id: 'cmp_SAMPLE_2', name: 'Demo Works', country: 'CZ', registryIds: [], isDreamCompany: false, claims: [], ghostSignals: [] }];
  const market = paths.map((path, i) => ({ occupation: path.occupation, location: { country: 'CZ', city: 'Prague' }, vacancyCount: path.vacancyCount, skillDemand: [{ skill: [skill('python', 'Python'), skill('sql', 'SQL'), skill('testing', 'Software testing')][i], vacanciesRequiring: [21, 16, 12][i], vacanciesTotal: path.vacancyCount, sources: [source('demand-' + i, 'Example job ad collection', 'Fictional sample skill demand.')] }] }));
  const validation = { validationId: 'val_SAMPLE_JANE_EXAMPLE', seekerId: profile.seekerId, runId: 'run_SAMPLE_JANE_EXAMPLE', profileVersion: 1, createdAt: '2026-01-01T00:00:00Z', occupation: OCC[0], locations: profile.preferences.locations, jobProfile: { occupation: OCC[0], vacanciesAnalysed: 41, markets: [{ country: 'CZ', city: 'Prague', vacancies: 41 }], skills: [], ladder: paths[0].ladder }, skills: [], companies: [], market: [] };
  const chapters = [
    ['chp_SAMPLE_1', 'Variables and logic', 'code', skill('python', 'Python'), 21, false],
    ['chp_SAMPLE_2', 'Working with SQL', 'data', skill('sql', 'SQL'), 16, true],
    ['chp_SAMPLE_3', 'Build an example API', 'project', skill('api', 'Web APIs'), 12, false],
  ].map(([chapterId, title, category, taught, required, done], i) => ({ chapterId, title, category, skills: [taught], demand: { vacanciesRequiring: required, vacanciesTotal: 41, sources: [source('chapter-demand-' + i, 'Example job ads', 'Fictional sample demand quote.')] }, evidence: done ? 'stated' : 'none', claims: done ? profile.statedSkills : [], outcome: 'Create a small fictional example project that demonstrates ' + String(title).toLowerCase() + '.', estimatedHours: 8 + i * 4, resources: [{ resourceId: 'res_SAMPLE_' + i, title: 'Example learning resource: ' + title, provider: 'Example University', url: 'https://example.com/course-' + i, format: i === 2 ? 'practice' : 'course', cost: i === 1 ? 'paid' : 'free', ...(i === 1 ? { price: 'CZK 490' } : {}), level: 'beginner', lang: 'en', scope: 'Example section', effortHours: 6 + i, source: source('resource-' + i, 'Example course page', 'Fictional sample resource details.') }], topPickId: 'res_SAMPLE_' + i, done, ...(done ? { doneBy: 'evidence' } : {}) }));
  const roadmap = { roadmapId: 'rmp_SAMPLE_JANE_EXAMPLE', seekerId: profile.seekerId, validationId: validation.validationId, runId: validation.runId, occupation: OCC[0], goal: 'learn-fast', status: 'ready', target: { step: paths[0].ladder[0], facts: paths[0].why }, modules: [{ moduleId: 'mod_SAMPLE_1', title: 'Python foundations', subtitle: 'Core building blocks', why: 'These foundations support the later example projects.', chapters: chapters.slice(0, 2) }, { moduleId: 'mod_SAMPLE_2', title: 'APIs', subtitle: 'Build and ship', why: 'This turns the sample foundations into a visible project.', chapters: chapters.slice(2) }], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

  function samplePathOrder() {
    const jobs = [...OCC, ALT];
    return jobs.map((job, order) => {
      const ratings = intake.cards.rated.filter((item) => item.card.occupation.uri === job.uri);
      const score = ratings.reduce((sum, item) => sum + ({ like: 2, maybe: .5, no: -1.5 }[item.rating] || 0), 0);
      return { job, order, score, liked: ratings.filter((item) => item.rating === 'like').length, maybe: ratings.filter((item) => item.rating === 'maybe').length, notForMe: ratings.filter((item) => item.rating === 'no').length };
    }).sort((a, b) => b.score - a.score || a.order - b.order).map((item, index) => ({ occupation: item.job, liked: item.liked, maybe: item.maybe, notForMe: item.notForMe, top3: index < 3 }));
  }

  async function api(method, path, body) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (path === '/v1/seekers' && method === 'POST') return { seekerId: profile.seekerId };
    if (/\/intake$/.test(path) && method === 'GET') return structuredClone(intake);
    if (/\/intake\/warmup$/.test(path)) {
      const q = warmupQuestions.find((item) => item.key === body.questionKey);
      intake.warmup.answers.push({ key: body.questionKey, answer: body.answer, mappedTo: q && q.options.includes(body.answer) ? [body.answer] : [q.options[0]], ...(q && !q.options.includes(body.answer) ? { reply: 'That makes sense. I mapped it to the closest sample option.' } : {}) });
      const next = warmupQuestions[intake.warmup.answers.length];
      if (next) intake.warmup.currentKey = next.key;
      else { delete intake.warmup.currentKey; intake.phase = 'cards'; intake.cards.current = { cardId: cards[0].cardId, text: cards[0].text, source: cards[0].source }; }
      return structuredClone(intake);
    }
    if (/\/intake\/cards\/[^/]+\/rating$/.test(path)) {
      const card = allCards.find((item) => path.includes(item.cardId));
      intake.cards.rated.push({ card, rating: body.rating, at: new Date().toISOString() });
      const roundCards = extraRound ? activeExtraCards : cards;
      const ratedInRound = intake.cards.rated.filter((item) => roundCards.some((candidate) => candidate.cardId === item.card.cardId));
      const next = roundCards[ratedInRound.length];
      if (next) intake.cards.current = { cardId: next.cardId, text: next.text, source: next.source };
      else {
        delete intake.cards.current; intake.cards.done = true;
        intake.phase = extraRound ? resumePhase : (intake.practical ? 'chat' : 'practical');
        intake.paths = samplePathOrder();
        if (extraRound) {
          extraRound = false;
          profile.preferences.targetOccupations = intake.paths.filter((item) => item.top3).map((item) => item.occupation);
          paths = profile.preferences.targetOccupations.map((job, i) => initialPaths.find((item) => item.occupation.uri === job.uri) || { occupation: job, why: [{ id: 'clm_SAMPLE_extra_path', statement: 'This fictional path came from the extra sample tasks.', kind: 'fact', subject: { type: 'occupation', id: job.uri }, confidence: 1, tier: 'single-source', sources: [source('extra-path', 'Example market page', 'Fictional sample path evidence.')], createdAt: '2026-01-01T00:00:00Z' }], vacancyCount: 9, ladder: [{ level: 'junior', title: 'Junior ' + job.label, salary: { median: 45000 + i * 1000, currency: 'CZK', period: 'month', sampleSize: 4, location: { country: 'CZ', city: 'Prague' } }, claims: [] }] });
          profile.profileVersion += 1; profile.updatedAt = new Date().toISOString();
        }
      }
      return structuredClone(intake);
    }
    if (/\/intake\/cards\/more$/.test(path)) {
      const seen = new Set(intake.cards.rated.map((item) => item.card.cardId));
      activeExtraCards = extraCards.filter((item) => !seen.has(item.cardId)).slice(0, 4);
      if (activeExtraCards.length < 4) throw new Error('Four more sample task cards are not available');
      resumePhase = intake.phase; extraRound = true; intake.phase = 'cards'; intake.cards.done = false;
      intake.cards.current = { cardId: activeExtraCards[0].cardId, text: activeExtraCards[0].text, source: activeExtraCards[0].source };
      return structuredClone(intake);
    }
    if (/\/intake\/practical$/.test(path)) { intake.practical = body; intake.phase = 'chat'; return structuredClone(intake); }
    if (/\/intake\/chat\/skip$/.test(path)) { intake.phase = 'done'; return structuredClone(intake); }
    if (/\/interview\/messages$/.test(path)) return { reply: body.text ? 'Thanks, Jane Example. That is enough for this sample.' : 'Anything else I should know—deal breakers, salary expectations, or a question?', done: !!body.text, preferences: profile.preferences };
    if (/\/documents$/.test(path)) return { id: 'doc_SAMPLE_1', fileName: 'jane-example-cv.pdf', statedSkills: profile.statedSkills, experience: [], education: [] };
    if (/\/documents\//.test(path) && method === 'DELETE') return { deleted: true };
    if (/\/links$/.test(path)) return [];
    if (/\/profile$/.test(path)) return structuredClone(profile);
    if (/\/career-choice$/.test(path)) { profile.careerChoice = { occupation: paths.find((p) => p.occupation.uri === body.occupationUri).occupation, runId: body.runId, chosenAt: new Date().toISOString() }; return profile.careerChoice; }
    if (path === '/v1/research-runs' && method === 'POST') { runNumber += 1; return { runId: 'run_SAMPLE_JANE_EXAMPLE_' + runNumber, status: 'queued' }; }
    if (/\/career-paths$/.test(path)) return structuredClone(paths);
    if (/\/companies/.test(path)) return structuredClone(companies);
    if (/\/market$/.test(path)) return structuredClone(market);
    if (/\/vacancies/.test(path)) return [{ id: 'vac_SAMPLE_1', companyId: companies[0].id }, { id: 'vac_SAMPLE_2', companyId: companies[1].id }];
    if (/^\/v1\/research-runs\/[^/]+$/.test(path)) { runPolls += 1; const done = runPolls > 2; if (done) sessionStorage.setItem('sampleRunDone', '1'); return { runId: path.split('/').pop(), seekerId: profile.seekerId, profileVersion: profile.profileVersion, status: done ? 'done' : 'running', progress: [{ step: 'career-paths', done: 1, total: 1 }, { step: 'companies', done: done ? 2 : 1, total: 2 }, { step: 'vacancies', done: done ? 41 : 18, total: 41 }, { step: 'market', done: done ? 3 : 1, total: 3 }, { step: 'seeker-research', done: done ? 1 : 0, total: 1 }], ...(done ? { result: { careerPaths: paths, companyIds: companies.map((c) => c.id), vacancyIds: Array.from({ length: 4 }, (_, i) => 'vac_SAMPLE_' + i), market, seekerResearch: { links: [] } } } : {}), cost: [] }; }
    if (path === '/v1/voice/transcribe') return { text: 'I enjoy solving example problems.' };
    if (path === '/v1/validations') return structuredClone(validation);
    if (path === '/v1/roadmaps') return structuredClone(roadmap);
    if (/^\/v1\/roadmaps\/[^/]+$/.test(path)) return structuredClone(roadmap);
    if (/\/chapters\/[^/]+\/progress$/.test(path)) { const chapter = chapters.find((item) => path.includes(item.chapterId)); chapter.done = body.done; if (body.done) chapter.doneBy = 'seeker'; else delete chapter.doneBy; return structuredClone(chapter); }
    throw new Error('No offline sample for ' + method + ' ' + path);
  }
  function reset() { intake = newIntake(); extraRound = false; activeExtraCards = []; resumePhase = 'done'; runNumber = 0; paths = structuredClone(initialPaths); profile.preferences.targetOccupations = OCC; profile.profileVersion = 1; runPolls = 0; sessionStorage.removeItem('sampleRunDone'); }
  return { api, profile, paths, companies, market, validation, roadmap, reset };
})();
