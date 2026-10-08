// Shared bits: header, icons, isometric tile.
const LOGO = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M14 3 25 9.5 14 16 3 9.5Z" fill="#B8F25B"/><path d="M3 9.5V18L14 24.5V16Z" fill="#6E9E35"/><path d="M25 9.5V18L14 24.5V16Z" fill="#4C7A2E"/></svg>';

const ICON = {
  arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B8F25B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  ext: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A3AB9C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>'
};

const TILE = {
  current: ['#B8F25B', '#7DB33A', '#5C8F2A', '#D4FA92', '#0D0F0C'],
  open: ['#2F3A27', '#232B1D', '#1B2217', '#4A5E36', '#D4FA92'],
  later: ['#23261F', '#1A1C17', '#151713', '#2F332B', '#6F7869'],
  done: ['#4C7A2E', '#33521F', '#284118', '#4C7A2E', '#D4FA92']
};

function tile(state, label, w = 120, h = 100) {
  const [top, left, right, edge, num] = TILE[state];
  const inner = label === '✓'
    ? '<path d="M42 33l12 11 24-20" stroke="' + num + '" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
    : (label !== undefined ? '<text x="60" y="40" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="700" font-size="22" fill="' + num + '">' + label + '</text>' : '');
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 120 100" fill="none" aria-hidden="true">' +
    '<path d="M60 4 116 32 60 60 4 32Z" fill="' + top + '" stroke="' + edge + '" stroke-width="1.5"/>' +
    '<path d="M4 32 60 60V92L4 64Z" fill="' + left + '"/>' +
    '<path d="M116 32 60 60V92L116 64Z" fill="' + right + '"/>' + inner + '</svg>';
}

function renderHeader() {
  const el = document.getElementById('top');
  if (!el) return;
  const step = Number(el.dataset.step || 0);
  const steps = [['index.html', 'Interview'], ['research.html', 'Research'], ['paths.html', 'Paths'], ['roadmap.html', 'Roadmap']];
  el.className = 'top';
  el.innerHTML =
    '<a class="brand" href="index.html">' + LOGO + '[Product name]</a>' +
    '<nav class="steps" aria-label="Steps">' + steps.map(([href, name], i) =>
      '<a href="' + href + '" class="' + (i + 1 === step ? 'on' : i + 1 < step ? 'past' : '') + '">' + (i + 1) + ' ' + name + '</a>').join('') + '</nav>' +
    '<span class="sample">Sample data</span>';
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

document.addEventListener('DOMContentLoaded', renderHeader);
