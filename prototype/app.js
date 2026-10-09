// Shared bits: header, icons, isometric tile.
const LOGO_PATH = 'M1.88721 0C18.2022 1.05565 35.6589 1.57716 51.7808 3.10449C51.5561 12.9603 51.0169 23.351 50.3384 33.1934C48.0648 66.2833 50.6482 190 98.4351 190.943C87.5079 156.352 81.0214 110.171 97.231 75.9941C111.741 45.407 144.599 29.2355 176.52 44.8008C212.296 63.021 215.934 109.268 206.332 143.579C198.886 170.187 186.027 191.128 166.43 210.354C197.26 240.311 227.091 201.149 239.478 174.119C264.47 119.583 268.546 59.9441 270.583 0.948242C287.075 1.23574 303.566 1.61269 320.054 2.06641C320.797 38.4352 316.258 80.7158 309.666 116.406C298.671 175.919 265.136 265.681 193.527 271.097C191.377 271.302 185.978 271.313 183.809 271.094C156.226 268.315 140.061 256.466 122.849 236.832C113.585 239.932 102.412 241.843 92.7485 240.818C8.12813 231.846 0.0127886 115.952 0.00830078 52.9629C-0.081558 35.2907 0.548211 17.6228 1.88721 0ZM156.211 91.4424C152.25 87.7275 150.902 87.728 146.61 91.416C133.031 106.905 137.24 143.912 142.377 162.563C152.843 147.217 160.422 130.727 161.015 111.806C161.248 104.376 160.44 97.7 156.211 91.4424Z';
const LOGO = '<svg width="30" height="26" viewBox="0 0 321 272" aria-hidden="true"><path d="' + LOGO_PATH + '" fill="#B8F25B"/></svg>';
// Step icons from Lucide (lucide.dev, ISC licence).
const STEP_ICON = {
  interview: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  research: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  paths: '<path d="M12 13v8"/><path d="M12 3v3"/><path d="M18 6a2 2 0 0 1 1.387.56l2.307 2.22a1 1 0 0 1 0 1.44l-2.307 2.22A2 2 0 0 1 18 13H6a2 2 0 0 1-1.387-.56l-2.306-2.22a1 1 0 0 1 0-1.44l2.306-2.22A2 2 0 0 1 6 6z"/>',
  roadmap: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>'
};

const ICON = {
  arrow: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  ext: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A3AB9C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>'
};

const TILE = {
  current: ['#B8F25B', '#7DB33A', '#5C8F2A', '#D4FA92', '#0D0F0C'],
  open: ['#2F3A27', '#232B1D', '#1B2217', '#4A5E36', '#D4FA92'],
  later: ['#23261F', '#1A1C17', '#151713', '#2F332B', '#6F7869'],
  done: ['#4C7A2E', '#33521F', '#284118', '#4C7A2E', '#D4FA92']
};

// Rounded path through a polygon: each corner becomes a curve of radius r.
function roundPath(pts, r) {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i], prev = pts[(i + n - 1) % n], next = pts[(i + 1) % n];
    const lp = Math.hypot(prev[0] - p[0], prev[1] - p[1]), ln = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const a = [p[0] + (prev[0] - p[0]) * r / lp, p[1] + (prev[1] - p[1]) * r / lp];
    const b = [p[0] + (next[0] - p[0]) * r / ln, p[1] + (next[1] - p[1]) * r / ln];
    d += (i ? 'L' : 'M') + a[0].toFixed(2) + ' ' + a[1].toFixed(2) + 'Q' + p[0] + ' ' + p[1] + ' ' + b[0].toFixed(2) + ' ' + b[1].toFixed(2);
  }
  return d + 'Z';
}
let tileId = 0;
const TILE_RADIUS = 12;
function tile(state, label, w = 120, h = 100, radius = TILE_RADIUS) {
  const [top, left, right, edge, num] = TILE[state];
  const id = 'tc' + (++tileId);
  const hex = [[60, 4], [116, 32], [116, 64], [60, 92], [4, 64], [4, 32]];
  // label: '✓' = done check, 'logo' = WayMark decal on the top face, anything else = text.
  const decal = '<g transform="matrix(72 0 0 36 24 14)"><g transform="translate(.23 .27) scale(' + (0.54 / 321) + ')"><path d="' + LOGO_PATH + '" fill="' + num + '" opacity=".92"/></g></g>';
  const inner = label === '✓'
    ? '<path d="M42 33l12 11 24-20" stroke="' + num + '" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
    : label === 'logo' ? decal
    : (label !== undefined ? '<text x="60" y="40" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="700" font-size="22" fill="' + num + '">' + label + '</text>' : '');
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 120 100" fill="none" aria-hidden="true">' +
    '<defs><clipPath id="' + id + '"><path d="' + roundPath(hex, radius) + '"/></clipPath></defs>' +
    '<g clip-path="url(#' + id + ')">' +
    '<path d="M4 32 60 60V92L4 64Z" fill="' + left + '"/>' +
    '<path d="M116 32 60 60V92L116 64Z" fill="' + right + '"/>' +
    '<path d="M60 4 116 32 60 60 4 32Z" fill="' + top + '"/>' +
    '<path d="M4 32 60 60 116 32" stroke="' + edge + '" stroke-width="1.5" stroke-linejoin="round"/>' +
    '</g>' + inner + '</svg>';
}

function renderHeader() {
  const el = document.getElementById('top');
  if (!el) return;
  const step = Number(el.dataset.step || 0);
  el.className = 'top';
  el.innerHTML = '<a class="brand" href="index.html">' + LOGO + 'WayMark</a><span class="sample">Sample data</span>';
  const steps = [['index.html', 'Interview', 'interview'], ['research.html', 'Research', 'research'], ['paths.html', 'Paths', 'paths'], ['roadmap.html', 'Roadmap', 'roadmap']];
  const nav = document.createElement('nav');
  nav.className = 'stepbar';
  nav.setAttribute('aria-label', 'Steps');
  nav.innerHTML = steps.map(([href, name, ic], i) => {
    const cls = i + 1 === step ? 'on' : i + 1 < step ? 'past' : '';
    return (i ? '<svg class="wave ' + (i + 1 <= step ? 'lit' : '') + '" viewBox="0 0 56 10" aria-hidden="true"><path d="M2 5 Q8.5 1 15 5 T28 5 T41 5 T54 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 4.5"/></svg>' : '') +
      '<a href="' + href + '" class="' + cls + '"' + (cls === 'on' ? ' aria-current="step"' : '') + '><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + STEP_ICON[ic] + '</svg><span>' + name + '</span></a>';
  }).join('');
  document.body.appendChild(nav);
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

document.addEventListener('DOMContentLoaded', renderHeader);
