import { createHero } from './hero3d.js';
import { DEMO } from './demo.js';

const OWNER = 'Haithamseleem';
const REPO = 'linkedin-autopilot';
const BRANCH = 'main';
const API = 'https://api.github.com';
const TZ = 'Asia/Dubai';
const MONTHLY_LIMIT = 15;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS = {
  draft: ['●', 'Needs review'], scheduled: ['◷', 'Scheduled'], published: ['✓', 'Published'],
  skipped: ['–', 'Skipped'], failed: ['✕', 'Failed'], deleted: ['✕', 'Deleted in Publora'], posted: ['✓', 'Posted'],
};

const state = {
  token: sessionStorage.getItem('gh-token') || localStorage.getItem('gh-token'),
  demo: new URLSearchParams(location.search).has('demo'),
  settings: null, posts: [], comments: [], runs: [], automation: true, user: null, pngs: new Map(),
  blobs: new Map(), images: new Map(), view: 'desk', tab: 'draft', hero: null, pollUntil: 0,
};

// ---------- small helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const fmt = (iso, opts) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date(iso)) : '');
const fmtSlot = (iso) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  return hr < 24 ? `${hr} h ago` : `${Math.round(hr / 24)} d ago`;
};
const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const monthKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date(iso));
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'post';
const firstLine = (body) => (body || '').split('\n').find((l) => l.trim()) || '(empty)';
const imagePath = (doc) => `${doc.path.slice(0, doc.path.lastIndexOf('/'))}/${doc.meta.image_file}`;
const b64encode = (s) => { let bin = ''; new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };
const b64bytes = (b) => Uint8Array.from(atob(b.replace(/\n/g, '')), (c) => c.charCodeAt(0));

function toast(msg, error = false) {
  const t = h('div', { class: `toast${error ? ' error' : ''}`, role: error ? 'alert' : 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), error ? 9000 : 5000);
}
function pill(status, label) {
  const [icon, word] = STATUS[status] || ['•', status];
  return h('span', { class: `pill ${status}` }, h('span', { 'aria-hidden': 'true' }, icon), label || word);
}

// ---------- the same file format, checks and slots as the automation repo ----------
function parseDoc(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const raw = line.slice(i + 1).trim();
    let value = raw;
    if (raw.startsWith('"')) { try { value = JSON.parse(raw); } catch { value = raw.replace(/^"|"$/g, ''); } }
    meta[line.slice(0, i).trim()] = value;
  }
  return { meta, body: m[2].trim() };
}
const serializeDoc = (meta, body) => `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(String(v ?? ''))}`).join('\n')}\n---\n${body.trim()}\n`;

function lint(text, kind = 'post') {
  const s = state.settings;
  const issues = [];
  const words = text.split(/\s+/).filter(Boolean).length;
  const maxEm = Math.max(1, Math.floor(words / 100));
  const em = (text.match(/—/g) || []).length;
  if (em > maxEm) issues.push(`${em} em dashes (max ${maxEm})`);
  if (/\s–\s|\s--\s/.test(text)) issues.push('en dash or double hyphen between clauses');
  const hits = (s.bannedWords || []).filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text));
  if (hits.length) issues.push(`banned words: ${hits.join(', ')}`);
  if ([/\bnot (just |only |merely )?[^.!?\n]{1,60}?,? but\b/i, /\bisn['’]t (about|just) [^.!?\n]{1,60}[.,;] (it['’]s|it is)\b/i, /\bit['’]s not [^.!?\n]{1,40}, it['’]s\b/i].some((r) => r.test(text))) issues.push('"not X but Y" style contrast');
  const emoji = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emoji > 1) issues.push(`${emoji} emoji`);
  if (/https?:\/\//i.test(text)) issues.push('link in the text (hurts reach)');
  const range = kind === 'post' ? s.postLength : s.commentLength;
  const len = [...text].length;
  if (len < range.min || len > range.max) issues.push(`${len} characters (target ${range.min}-${range.max})`);
  if (kind === 'post') {
    const hook = [...text.split(/\n\s*\n/)[0]].length;
    if (hook > 210) issues.push(`hook is ${hook} characters (keep under 210)`);
    const tags = (text.match(/(^|\s)#\w+/g) || []).length;
    if (tags > s.maxHashtags) issues.push(`${tags} hashtags (max ${s.maxHashtags})`);
  }
  return issues;
}

function nextSlots(count, taken = []) {
  const [, sign, hh, mm] = state.settings.utcOffset.match(/([+-])(\d\d):(\d\d)/);
  const offset = (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60000;
  const now = Date.now();
  const takenSet = new Set(taken.map((t) => new Date(t).getTime()));
  const out = [];
  for (let d = 0; d < 8 && out.length < count; d++) {
    const local = new Date(now + offset + d * 86400000);
    const times = state.settings.slots.filter((s) => s.day === DAYS[local.getUTCDay()]).map((s) => s.time).sort();
    for (const time of times) {
      const [hr, mi] = time.split(':').map(Number);
      const t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hr, mi) - offset;
      if (t > now + 15 * 60000 && t <= now + 7 * 86400000 - 15 * 60000 && !takenSet.has(t) && out.length < count) out.push(new Date(t).toISOString());
    }
  }
  return out;
}

function toUrns(input) {
  let s = String(input || '').trim();
  try { s = decodeURIComponent(s); } catch { /* keep as typed */ }
  const post = s.match(/urn:li:(activity|share|ugcPost):(\d+)/) || s.match(/-(activity|share|ugcPost)-(\d+)/);
  const comment = s.match(/urn:li:comment:\((activity|share|ugcPost):(\d+),(\d+)\)/);
  return {
    postUrn: post ? `urn:li:${post[1]}:${post[2]}` : comment ? `urn:li:${comment[1]}:${comment[2]}` : null,
    commentUrn: comment ? `urn:li:comment:(${comment[1]}:${comment[2]},${comment[3]})` : null,
  };
}

// ---------- GitHub ----------
const repoPath = (p) => `/repos/${OWNER}/${REPO}${p}`;
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) {
    const err = new Error(res.status === 409 ? 'That file changed on GitHub since you opened it. Refresh and try again.' : `GitHub said ${res.status}: ${data?.message || 'request failed'}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function readBlob(sha) {
  if (!state.blobs.has(sha)) state.blobs.set(sha, new TextDecoder().decode(b64bytes((await gh(repoPath(`/git/blobs/${sha}`))).content)));
  return state.blobs.get(sha);
}
async function readFile(path) {
  const f = await gh(repoPath(`/contents/${encodePath(path)}?ref=${BRANCH}`));
  return { sha: f.sha, text: new TextDecoder().decode(b64bytes(f.content)) };
}
async function writeFile(path, text, sha, message) {
  if (state.demo) return { content: { sha: `demo-${Date.now()}` } };
  return gh(repoPath(`/contents/${encodePath(path)}`), { method: 'PUT', body: { message, content: b64encode(text), branch: BRANCH, ...(sha ? { sha } : {}) } });
}
async function dispatch(workflow, inputs) {
  if (state.demo) { toast('Demo mode: nothing was sent.'); return; }
  await gh(repoPath(`/actions/workflows/${workflow}/dispatches`), { method: 'POST', body: { ref: BRANCH, inputs } });
  state.pollUntil = Date.now() + 4 * 60000;
  poll();
}

async function loadAll() {
  if (state.demo) {
    const d = structuredClone(DEMO);
    Object.assign(state, { settings: d.settings, posts: d.posts, comments: d.comments, runs: d.runs, automation: state.demoAutomation ?? true, user: { login: 'demo' } });
    return;
  }
  const tree = await gh(repoPath(`/git/trees/${BRANCH}?recursive=1`));
  const blobs = tree.tree.filter((t) => t.type === 'blob');
  state.pngs = new Map(blobs.filter((t) => t.path.endsWith('.png')).map((t) => [t.path, t.sha]));
  const md = blobs.filter((t) => /^(posts|comments)\/.+\.md$/.test(t.path));
  const settingsSha = blobs.find((t) => t.path === 'config/settings.json')?.sha;
  const [settingsText, ...texts] = await Promise.all([readBlob(settingsSha), ...md.map((t) => readBlob(t.sha))]);
  state.settings = JSON.parse(settingsText);
  state.settingsSha = settingsSha;
  const docs = md.map((t, i) => ({ path: t.path, sha: t.sha, ...parseDoc(texts[i]) })).sort((a, b) => b.path.localeCompare(a.path, undefined, { numeric: true }));
  state.posts = docs.filter((d) => d.path.startsWith('posts/'));
  state.comments = docs.filter((d) => d.path.startsWith('comments/'));
  const [automation, runs, user] = await Promise.all([loadAutomation(), loadRuns(), state.user ? state.user : gh('/user').catch(() => ({ login: OWNER }))]);
  Object.assign(state, { automation, runs, user });
}
async function loadAutomation() {
  try { return (await gh(repoPath('/actions/variables/AUTOMATION_ENABLED'))).value !== 'false'; } catch (e) { if (e.status === 404) return true; throw e; }
}
async function loadRuns() {
  return (await gh(repoPath('/actions/runs?per_page=10'))).workflow_runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, created: r.created_at, url: r.html_url }));
}
async function setAutomation(on) {
  if (state.demo) { state.demoAutomation = on; return; }
  const body = { name: 'AUTOMATION_ENABLED', value: on ? 'true' : 'false' };
  try { await gh(repoPath('/actions/variables/AUTOMATION_ENABLED'), { method: 'PATCH', body }); } catch (e) { if (e.status !== 404) throw e; await gh(repoPath('/actions/variables'), { method: 'POST', body }); }
}

async function poll() {
  if (state.polling) return;
  state.polling = true;
  try {
    while (Date.now() < state.pollUntil) {
      await new Promise((r) => setTimeout(r, 10000));
      state.runs = await loadRuns();
      renderSide();
      if (!state.runs.some((r) => r.status !== 'completed') && Date.now() > state.pollUntil - 3 * 60000) {
        await loadAll();
        render();
        break;
      }
    }
  } catch (e) { toast(e.message, true); } finally { state.polling = false; }
}

async function imageUrl(doc) {
  if (state.demo || !doc.meta.image_file) return null;
  const sha = state.pngs.get(imagePath(doc));
  if (!sha) return null;
  if (!state.images.has(sha)) {
    const blob = await gh(repoPath(`/git/blobs/${sha}`));
    state.images.set(sha, URL.createObjectURL(new Blob([b64bytes(blob.content)], { type: 'image/png' })));
  }
  return state.images.get(sha);
}

// ---------- views ----------
function thumb(doc, fields) {
  const box = h('div', { class: 'thumb' });
  const meta = fields || doc.meta;
  const headline = h('div', { class: 'hd' });
  String(meta.image_headline || '').split(/(\*[^*]+\*)/).forEach((part) => headline.append(/^\*[^*]+\*$/.test(part) ? h('em', {}, part.slice(1, -1)) : part));
  const mock = h('div', { class: 'mock' }, h('div', { class: 'bar' }), h('div', { class: 'k' }, meta.image_kicker || ''), headline, h('div', { class: 'ft' }, meta.image_footer || ''));
  box.append(mock);
  if (!fields && meta.image_mode !== 'none') {
    imageUrl(doc).then((url) => { if (url) { mock.remove(); box.append(h('img', { src: url, alt: `Post image: ${meta.image_headline || ''}` })); } }).catch(() => {});
  }
  if (meta.image_mode === 'none') { box.replaceChildren(h('div', { class: 'mock' }, h('div', { class: 'ft' }, 'No image'))); }
  return box;
}

function signIn() {
  const app = document.getElementById('app');
  const input = h('input', { type: 'password', id: 'token', autocomplete: 'off', placeholder: 'github_pat_…' });
  const remember = h('input', { type: 'checkbox', id: 'remember', checked: true });
  const go = async () => {
    state.token = input.value.trim();
    if (!state.token) return toast('Paste your GitHub token first.', true);
    try {
      await gh(repoPath(''));
      (remember.checked ? localStorage : sessionStorage).setItem('gh-token', state.token);
      start();
    } catch (e) {
      state.token = null;
      toast(e.status === 401 || e.status === 404 ? 'That token cannot open Haithamseleem/linkedin-autopilot. Check the repository access and permissions.' : e.message, true);
    }
  };
  app.replaceChildren(h('main', { class: 'signin' },
    h('div', { class: 'eyebrow' }, 'LinkedIn Autopilot'),
    h('h1', {}, 'Control desk'),
    h('p', { class: 'hint' }, 'Sign in with a GitHub token that can open only your linkedin-autopilot repo. It stays in this browser and is sent only to GitHub.'),
    h('div', { class: 'stack' },
      h('label', { class: 'field', for: 'token' }, 'GitHub token', input),
      h('label', { class: 'row', for: 'remember' }, remember, 'Remember on this device'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: go }, 'Sign in'), h('a', { href: '?demo=1' }, 'Look around with sample data'))),
    h('details', {}, h('summary', {}, 'How to create the token (2 minutes)'),
      h('ol', {},
        h('li', {}, 'Open github.com → your picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.'),
        h('li', {}, 'Name: "LinkedIn control desk". Expiration: 90 days or longer.'),
        h('li', {}, 'Repository access: Only select repositories → linkedin-autopilot.'),
        h('li', {}, 'Repository permissions: Contents → Read and write, Actions → Read and write, Variables → Read and write. Leave everything else as is.'),
        h('li', {}, 'Generate, copy the token, and paste it above.')))));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  input.focus();
}

function shell() {
  const app = document.getElementById('app');
  const canvas = h('canvas', { class: 'hero-canvas', 'aria-label': 'A stack of draft cards with an approval stamp', role: 'img' });
  app.replaceChildren(h('div', { class: 'wrap' },
    h('header', { class: 'hero' },
      h('div', {},
        h('div', { class: 'eyebrow' }, state.demo ? 'LinkedIn Autopilot · sample data' : 'LinkedIn Autopilot'),
        h('h1', {}, 'Control desk'),
        h('p', {}, 'Review, edit and approve drafts, set the rules, and see every run. Nothing reaches LinkedIn until you approve it here or in Publora.'),
        h('div', { class: 'hero-actions', id: 'hero-actions' })),
      canvas),
    h('nav', { class: 'nav', id: 'nav' }),
    h('section', { class: 'kpis', id: 'kpis', 'aria-label': 'Summary' }),
    h('div', { id: 'view' })));
  try { state.hero = createHero(canvas); } catch { canvas.remove(); }
}

function render() {
  renderHeaderActions();
  renderNav();
  renderKpis();
  const view = document.getElementById('view');
  view.replaceChildren(state.view === 'desk' ? deskView() : state.view === 'comments' ? commentsView() : settingsView());
  if (state.view === 'desk') renderSide();
  state.hero?.setCount(state.posts.filter((p) => p.meta.status === 'draft').length);
}

function renderHeaderActions() {
  const on = state.automation;
  const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(on), title: 'Pauses or resumes every GitHub workflow (drafts, images, publishing)', onclick: async () => {
    sw.disabled = true;
    try { await setAutomation(!on); state.automation = !on; toast(!on ? 'Automation resumed.' : 'Automation paused. No workflow will run until you resume it.'); } catch (e) { toast(e.message, true); }
    renderHeaderActions();
  } }, h('span', { class: 'knob', 'aria-hidden': 'true' }), on ? 'Automation on' : 'Automation paused');
  document.getElementById('hero-actions').replaceChildren(
    sw,
    h('button', { class: 'btn secondary', onclick: () => openEditor(null) }, '+ Write a post'),
    h('button', { class: 'btn ghost', onclick: async () => { try { await dispatch('preview.yml', {}); toast('Syncing with Publora. Images and statuses update in a few minutes.'); } catch (e) { toast(e.message, true); } } }, '↻ Sync with Publora'),
  );
}

function renderNav() {
  const tab = (id, label) => h('button', { 'aria-current': state.view === id ? 'page' : null, onclick: () => { state.view = id; render(); } }, label);
  document.getElementById('nav').replaceChildren(
    tab('desk', 'Drafts & schedule'), tab('comments', 'Comments'), tab('settings', 'Settings'),
    h('span', { class: 'spacer' }),
    h('span', { class: 'who' }, `Signed in as ${state.user?.login || '…'} · `,
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); refresh(); } }, 'Refresh'), ' · ',
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); localStorage.removeItem('gh-token'); sessionStorage.removeItem('gh-token'); location.href = location.pathname; } }, state.demo ? 'Leave demo' : 'Sign out')));
}

function renderKpis() {
  const drafts = state.posts.filter((p) => p.meta.status === 'draft');
  const scheduled = state.posts.filter((p) => p.meta.status === 'scheduled').sort((a, b) => a.meta.scheduledTime.localeCompare(b.meta.scheduledTime));
  const month = monthKey(new Date().toISOString());
  const used = state.posts.filter((p) => ['published', 'scheduled'].includes(p.meta.status) && p.meta.scheduledTime && monthKey(p.meta.scheduledTime) === month);
  const published = used.filter((p) => p.meta.status === 'published').length;
  const share = used.length / MONTHLY_LIMIT;
  const fill = h('span');
  fill.style.width = `${Math.min(100, share * 100)}%`;
  const nextRun = nextSunday();
  const tile = (label, value, ...rest) => h('article', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), ...rest);
  document.getElementById('kpis').replaceChildren(
    tile('Drafts to review', drafts.length, h('div', { class: 'sub' }, drafts.length ? `Oldest from ${fmt(`${drafts.at(-1).meta.created}T12:00:00Z`, { day: 'numeric', month: 'short' })}` : 'All caught up')),
    tile('Scheduled', scheduled.length, h('div', { class: 'sub' }, scheduled.length ? `Next ${fmtSlot(scheduled[0].meta.scheduledTime)}` : 'Nothing queued')),
    tile('Posts this month', `${used.length} of ${MONTHLY_LIMIT}`,
      h('div', { class: `meter${share >= 1 ? ' bad' : share >= 0.8 ? ' warn' : ''}`, role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(MONTHLY_LIMIT), 'aria-valuenow': String(used.length), 'aria-label': 'Posts used this month' }, fill),
      h('div', { class: 'sub' }, `${published} published · ${used.length - published} scheduled · Publora Starter`)),
    tile('Next draft run', fmt(nextRun, { weekday: 'short', day: 'numeric', month: 'short' }), h('div', { class: 'sub' }, '09:00 in the Claude app')),
  );
}
function nextSunday() {
  const now = new Date();
  for (let d = 0; d < 8; d++) {
    const day = new Date(now.getTime() + d * 86400000);
    const iso = `${new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(day)}T09:00:00+04:00`;
    if (fmt(iso, { weekday: 'short' }) === 'Sun' && new Date(iso) > now) return iso;
  }
  return now.toISOString();
}

function deskView() {
  const groups = { draft: [], scheduled: [], published: [], skipped: [] };
  for (const p of state.posts) (groups[p.meta.status] || groups.skipped).push(p);
  const labels = { draft: 'To review', scheduled: 'Scheduled', published: 'Published', skipped: 'Skipped & other' };
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Filter posts' }, Object.keys(groups).map((k) =>
    h('button', { 'aria-pressed': String(state.tab === k), onclick: () => { state.tab = k; render(); } }, labels[k], h('span', { class: 'count' }, groups[k].length))));
  const items = groups[state.tab];
  const list = h('div', { class: 'list' }, items.length ? items.map(postCard) : h('div', { class: 'empty' }, state.tab === 'draft' ? 'No drafts waiting. The next batch arrives on Sunday.' : 'Nothing here yet.'));
  return h('div', { class: 'board' },
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Posts'), tabs), h('div', { class: 'panel-body' }, list)),
    h('aside', { class: 'side', id: 'side' }));
}

function postCard(doc) {
  const issues = state.settings ? lint(doc.body) : [];
  const when = doc.meta.scheduledTime ? fmtSlot(doc.meta.scheduledTime) : `Drafted ${doc.meta.created || ''}`;
  return h('button', { class: 'post-card', onclick: () => openEditor(doc) },
    thumb(doc),
    h('div', {},
      h('div', { class: 'row' }, doc.pending ? h('span', { class: 'pill pending' }, h('span', { 'aria-hidden': 'true' }, '◷'), doc.pending) : pill(doc.meta.status), h('span', { class: 'meta' }, when)),
      h('h3', {}, firstLine(doc.body)),
      h('p', { class: 'angle' }, doc.meta.angle || ''),
      h('div', { class: 'row meta' }, `${[...doc.body].length} characters`, doc.meta.status === 'draft' ? (issues.length ? h('span', {}, `· ${issues.length} check${issues.length > 1 ? 's' : ''} to fix`) : h('span', {}, '· checks passed')) : null)));
}

function renderSide() {
  const side = document.getElementById('side');
  if (!side) return;
  const upcoming = state.posts.filter((p) => p.meta.status === 'scheduled').sort((a, b) => a.meta.scheduledTime.localeCompare(b.meta.scheduledTime));
  const runIcon = (r) => (r.status !== 'completed' ? ['running', '◷', 'Running'] : r.conclusion === 'success' ? ['success', '✓', 'Succeeded'] : r.conclusion === 'failure' ? ['failure', '✕', 'Failed'] : ['other', '–', r.conclusion || 'Other']);
  side.replaceChildren(
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Coming up')),
      h('div', { class: 'panel-body' }, upcoming.length ? h('ul', { class: 'timeline' }, upcoming.map((p) => h('li', {},
        h('div', { class: 'date-chip' }, h('b', {}, fmt(p.meta.scheduledTime, { day: 'numeric' })), h('span', {}, fmt(p.meta.scheduledTime, { month: 'short' }))),
        h('div', {}, h('div', { class: 't' }, firstLine(p.body)), h('div', { class: 'meta' }, fmt(p.meta.scheduledTime, { weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })))))) : h('p', { class: 'hint' }, 'Nothing scheduled. Approve a draft to fill the calendar.'))),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Recent runs'), h('a', { href: `https://github.com/${OWNER}/${REPO}/actions`, target: '_blank', rel: 'noopener' }, 'All')),
      h('div', { class: 'panel-body' }, state.runs.length ? h('ul', { class: 'runs' }, state.runs.slice(0, 8).map((r) => {
        const [cls, icon, word] = runIcon(r);
        return h('li', {}, h('span', { class: `ic ${cls}`, title: word }, h('span', { 'aria-hidden': 'true' }, icon), h('span', { class: 'sr-only' }, word)),
          h('a', { class: 'name', href: r.url, target: '_blank', rel: 'noopener' }, r.name), h('span', { class: 'meta' }, ago(r.created)));
      })) : h('p', { class: 'hint' }, 'No runs yet.'))));
}

// ---------- editor ----------
function openEditor(doc) {
  const isNew = !doc;
  const editable = isNew || doc.meta.status === 'draft' || doc.meta.status === 'skipped';
  const meta = isNew
    ? { status: 'draft', created: todayLocal(), angle: '', image_mode: 'card', image_file: '', image_layout: 'question', image_theme: 'paper', image_art: 'agent', image_items: '', image_label: '', image_flags: '', image_note: '', image_kicker: '', image_headline: '', image_footer: '', image_cta: '', lint: '', postGroupId: '', scheduledTime: '', postedId: '' }
    : { image_layout: 'question', image_theme: 'paper', image_art: '', image_items: '', image_label: '', image_flags: '', image_note: '', image_cta: '', ...doc.meta };
  const root = document.getElementById('drawer-root');
  const close = () => { root.replaceChildren(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const text = h('textarea', { class: 'post', id: 'post-text', 'aria-label': 'Post text', readonly: editable ? null : true }, isNew ? '' : doc.body);
  const counter = h('span', { class: 'counter' });
  const checks = h('ul', { class: 'checks', 'aria-live': 'polite' });
  const field = (key, label, hint) => {
    const input = h('input', { type: 'text', value: meta[key] || '', readonly: editable ? null : true });
    input.addEventListener('input', () => { meta[key] = input.value; refreshPreview(); });
    return h('label', { class: 'field' }, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
  };
  const select = (key, label, options) => {
    const s = h('select', { disabled: editable ? null : true }, options.map(([v, t]) => h('option', { value: v, selected: meta[key] === v }, t)));
    s.addEventListener('change', () => { meta[key] = s.value; refreshPreview(); });
    return h('label', { class: 'field' }, label, s);
  };
  const itemsBox = h('textarea', { rows: 5, readonly: editable ? null : true }, String(meta.image_items || '').split('|').join('\n'));
  itemsBox.addEventListener('input', () => { meta.image_items = itemsBox.value.split('\n').map((l) => l.trim()).filter(Boolean).join('|'); refreshPreview(); });
  const frame = h('iframe', { class: 'card-frame', title: 'Image preview', tabindex: '-1' });
  // Custom images are made outside the card template, so show the saved picture instead of a card preview.
  const custom = !isNew && meta.image_mode === 'custom';
  const preview = editable && !custom ? h('div', { class: 'card-preview' }, frame) : h('div');
  const cardData = () => ({ layout: meta.image_layout, theme: meta.image_theme, art: meta.image_art, items: meta.image_items, label: meta.image_label, flags: meta.image_flags, note: meta.image_note, cta: meta.image_cta, kicker: meta.image_kicker, headline: meta.image_headline, footer: meta.image_footer });
  let timer;
  const refreshPreview = () => {
    if (!editable || custom) { preview.replaceChildren(thumb(doc)); return; }
    clearTimeout(timer);
    timer = setTimeout(() => { frame.src = `card.html#${encodeURIComponent(JSON.stringify(cardData()))}`; }, 150);
  };
  new ResizeObserver(() => { frame.style.transform = `scale(${preview.clientWidth / 1080})`; }).observe(preview);
  const refreshChecks = () => {
    const issues = lint(text.value);
    const len = [...text.value].length;
    const { min, max } = state.settings.postLength;
    counter.className = `counter ${len >= min && len <= max ? 'ok' : 'warn'}`;
    counter.textContent = `${len.toLocaleString('en')} / ${max.toLocaleString('en')} characters`;
    checks.replaceChildren(...(issues.length ? issues.map((i) => h('li', {}, h('span', { class: 'warn', 'aria-hidden': 'true' }, '●'), i)) : [h('li', {}, h('span', { class: 'ok', 'aria-hidden': 'true' }, '✓'), 'All checks passed')]));
  };
  text.addEventListener('input', refreshChecks);

  const angle = field('angle', 'Angle (for your notes)');
  const body = h('div', { class: 'drawer-body' },
    h('div', { class: 'stack' }, preview,
      custom ? h('p', { class: 'hint' }, 'Custom image made by Claude for this post. To change it, ask Claude; the card settings don\'t apply.') : editable ? h('div', { class: 'stack' },
        h('div', { class: 'grid-2' },
          select('image_layout', 'Layout', [['question', 'Big question'], ['flow', 'Process flow'], ['checklist', 'Checklist'], ['versus', 'Before / after'], ['alert', 'System message']]),
          select('image_theme', 'Paper', [['paper', 'Notebook (off-white)'], ['blueprint', 'Blueprint (SAP blue)'], ['board', 'Board (Accenture purple)']])),
        field('image_headline', 'Headline', 'Wrap one word in *asterisks* to highlight it.'),
        field('image_art', 'Shapes', 'Up to 3: agent, human, ship, truck, car, plane, warehouse, factory, po, invoice, box, shield, calendar, cart, data, chart. Put ! before one to mark where it breaks.'),
        field('image_flags', 'Country flags', 'Up to 4: ae, sa, qa, kw, om, bh, eg'),
        field('image_note', 'Handwritten note', 'Points at the problem step, e.g. who clears this?'),
        h('label', { class: 'field' }, 'Items (one per line)', itemsBox,
          h('span', { class: 'hint' }, 'Flow: shape:Step — detail. Checklist: one action per line (! warning, ✕ don\'t). Before/after: 4 lines, shape:Title / text / shape:Title / text. System message: E, W or S, then the message, then Field: value lines.')),
        field('image_label', 'Label (plain text, no logos)', 'e.g. SAP S/4HANA, SAP Ariba, AI agents'),
        field('image_kicker', 'Small line on top'),
        field('image_footer', 'Footer'),
        field('image_cta', 'Call to action', 'e.g. Where does yours break?'),
        h('p', { class: 'hint' }, 'The preview shows exactly what GitHub draws after you save.')) : null),
    h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('label', { class: 'field', for: 'post-text' }, 'Post text'), h('span', { class: 'spacer' }), counter),
      text, checks, angle));

  const save = async (quiet) => {
    if (!text.value.trim()) throw new Error('The post text is empty.');
    let path = doc?.path;
    if (isNew) {
      const day = todayLocal();
      const n = state.posts.filter((p) => p.path.startsWith(`posts/${day}/`)).length + 1;
      const slug = slugify(meta.image_headline || firstLine(text.value)).split('-').slice(0, 4).join('-');
      path = `posts/${day}/${n}-${slug}.md`;
      meta.image_file = `${n}-${slug}.png`;
    }
    meta.lint = lint(text.value).join('; ') || 'ok';
    const res = await writeFile(path, serializeDoc(meta, text.value), doc?.sha, isNew ? 'Add a post from the control desk' : 'Edit draft from the control desk');
    const saved = { path, sha: res.content.sha, meta: { ...meta }, body: text.value.trim() };
    if (isNew) state.posts.unshift(saved); else Object.assign(doc, saved);
    if (!quiet) toast(isNew ? 'Saved. GitHub draws the image and sends it to Publora as a draft.' : 'Saved. Publora gets the new text in a few minutes.');
    render();
    return isNew ? state.posts[0] : doc;
  };
  const guard = (fn) => async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await fn(); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  };

  const slot = state.settings ? nextSlots(1, state.posts.filter((p) => p.meta.status === 'scheduled').map((p) => p.meta.scheduledTime))[0] : null;
  const when = h('input', { type: 'datetime-local', 'aria-label': 'Date and time (UAE)' });
  const choice = (value, label, checked) => h('label', {}, h('input', { type: 'radio', name: 'when', value, checked }), label);
  const approveBox = h('div', { class: 'approve-box', hidden: true },
    h('strong', {}, 'When should it go out?'),
    slot ? choice('next-slots', `Next free slot: ${fmtSlot(slot)}`, true) : null,
    choice('time', 'At a time I choose (UAE time):', !slot), when,
    choice('now', 'Publish now'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: guard(async () => {
        const pick = approveBox.querySelector('input[name="when"]:checked')?.value;
        let value = pick;
        if (pick === 'time') {
          if (!when.value) throw new Error('Pick a date and time first.');
          const iso = `${when.value}:00${state.settings.utcOffset}`;
          const t = new Date(iso).getTime();
          if (t < Date.now() + 15 * 60000 || t > Date.now() + 7 * 86400000) throw new Error('Publora on your plan can schedule from 15 minutes up to 7 days ahead.');
          value = iso;
        }
        if (pick === 'now' && !confirm('Publish this post on LinkedIn now?')) return;
        const target = text.value.trim() !== (doc?.body || '') || isNew || Object.keys(meta).some((k) => k.startsWith('image_') || k === 'angle' ? (meta[k] || '') !== (doc.meta[k] || '') : false) ? await save(true) : doc;
        await dispatch('publish.yml', { drafts: target.path, when: value });
        target.pending = pick === 'now' ? 'Publishing…' : 'Scheduling…';
        toast(pick === 'now' ? 'Approved. GitHub is publishing it now.' : 'Approved. GitHub is scheduling it; the calendar updates in a minute or two.');
        close();
        render();
      }) }, 'Confirm approval'),
      h('button', { class: 'btn ghost', onclick: () => { approveBox.hidden = true; } }, 'Cancel')));

  const actions = [];
  if (editable) {
    actions.push(h('button', { class: 'btn secondary', onclick: guard(() => save(false)) }, 'Save changes'));
    if (!isNew && doc.meta.status === 'draft') actions.push(h('button', { class: 'btn ghost', onclick: guard(async () => { meta.status = 'skipped'; await save(true); toast('Skipped. It stays in the history and never goes out.'); close(); }) }, 'Skip this one'));
    if (!isNew && doc.meta.status === 'skipped') actions.push(h('button', { class: 'btn ghost', onclick: guard(async () => { meta.status = 'draft'; await save(true); toast('Back in the review list.'); close(); }) }, 'Restore to drafts'));
    if (isNew || doc.meta.status === 'draft') actions.push(h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: () => { approveBox.hidden = !approveBox.hidden; } }, 'Approve…'));
  }
  const note = !editable ? h('div', { class: 'notice' }, doc.meta.status === 'scheduled'
    ? `Scheduled for ${fmtSlot(doc.meta.scheduledTime)} (UAE). To change or cancel it, open the post in Publora.`
    : doc.meta.status === 'published' ? 'Published on LinkedIn. This is the final text.' : 'This post can no longer be edited here.') : null;
  const links = !editable ? h('div', { class: 'row' },
    h('a', { class: 'btn secondary', href: 'https://app.publora.com', target: '_blank', rel: 'noopener' }, 'Open Publora'),
    doc.meta.postedId ? h('a', { class: 'btn ghost', href: `https://www.linkedin.com/feed/update/${doc.meta.postedId}/`, target: '_blank', rel: 'noopener' }, 'View on LinkedIn') : null) : null;

  root.replaceChildren(
    h('div', { class: 'backdrop', onclick: close }),
    h('section', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': isNew ? 'Write a post' : 'Edit draft' },
      h('div', { class: 'drawer-head' }, isNew ? pill('draft', 'New post') : pill(doc.meta.status), h('h2', {}, isNew ? 'Write a post' : firstLine(doc.body)), h('button', { class: 'btn ghost', onclick: close, 'aria-label': 'Close' }, '✕')),
      body,
      h('div', { class: 'drawer-foot' }, note, links, ...actions, approveBox)));
  refreshPreview();
  refreshChecks();
  (editable ? text : root.querySelector('.drawer-head button')).focus();
}

// ---------- comments ----------
function commentsView() {
  const link = h('input', { type: 'url', placeholder: 'https://www.linkedin.com/feed/update/urn:li:activity:…' });
  const reply = h('input', { type: 'url', placeholder: 'Optional: link to the comment you are replying to' });
  const text = h('textarea', { rows: 6, placeholder: 'Write your comment (200–350 characters works best)' });
  const counter = h('span', { class: 'counter' });
  const checks = h('ul', { class: 'checks' });
  const refresh = () => {
    const issues = text.value ? lint(text.value, 'comment') : [];
    const len = [...text.value].length;
    counter.className = `counter ${issues.length ? 'warn' : 'ok'}`;
    counter.textContent = `${len} characters`;
    checks.replaceChildren(...issues.map((i) => h('li', {}, h('span', { class: 'warn', 'aria-hidden': 'true' }, '●'), i)));
  };
  text.addEventListener('input', refresh);
  const create = async (postNow) => {
    const target = toUrns(link.value);
    const parent = toUrns(reply.value);
    const postUrn = target.postUrn || parent.postUrn;
    if (!postUrn) throw new Error('That link does not look like a LinkedIn post. Copy it from the post’s "…" menu → Copy link to post.');
    if (!text.value.trim()) throw new Error('Write the comment first.');
    const day = todayLocal();
    const n = state.comments.filter((c) => c.path.startsWith(`comments/${day}/`)).length + 1;
    const path = `comments/${day}/${n}-${slugify(text.value).split('-').slice(0, 4).join('-')}.md`;
    const meta = { status: 'draft', created: day, postUrn, parentComment: parent.commentUrn || '', lint: lint(text.value, 'comment').join('; ') || 'ok', commentUrn: '' };
    const res = await writeFile(path, serializeDoc(meta, text.value), null, 'Add a comment from the control desk');
    state.comments.unshift({ path, sha: res.content.sha, meta, body: text.value.trim() });
    if (postNow) {
      if (!confirm('Post this comment on LinkedIn now?')) return render();
      await dispatch('comment.yml', { mode: 'post', file: path });
      toast('Sent. GitHub posts the comment in about a minute.');
    } else {
      toast('Saved as a draft comment.');
    }
    render();
  };
  const guard = (fn) => async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { toast(err.message, true); } finally { b.disabled = false; } };
  refresh();
  return h('div', { class: 'board' },
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Write a comment or reply')),
      h('div', { class: 'panel-body stack' },
        h('label', { class: 'field' }, 'LinkedIn post link', link),
        h('label', { class: 'field' }, 'Replying to a comment? (optional)', reply),
        h('label', { class: 'field' }, h('span', { class: 'row' }, 'Your comment', h('span', { class: 'spacer' }), counter), text),
        checks,
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: guard(() => create(true)) }, 'Post comment'), h('button', { class: 'btn secondary', onclick: guard(() => create(false)) }, 'Save as draft')),
        h('p', { class: 'hint' }, 'Want help with the wording? Ask Claude in the app and paste the post or comment; then paste the result here.'))),
    h('aside', { class: 'side' }, h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Recent comments')),
      h('div', { class: 'panel-body' }, state.comments.length ? h('div', { class: 'list' }, state.comments.slice(0, 12).map((c) => h('div', { class: 'post-card', role: 'group' },
        h('div', { class: 'meta' }, c.meta.created),
        h('div', {}, h('div', { class: 'row' }, pill(c.meta.status), c.meta.status === 'draft' ? h('button', { class: 'btn ghost', onclick: guard(async () => { if (!confirm('Post this comment on LinkedIn now?')) return; await dispatch('comment.yml', { mode: 'post', file: c.path }); toast('Sent. GitHub posts it in about a minute.'); }) }, 'Post now') : null),
          h('h3', {}, firstLine(c.body)))))) : h('p', { class: 'hint' }, 'No comments yet.')))));
}

// ---------- settings ----------
const CONFIG_FILES = [
  ['config/topics.md', 'Topics and story notes', 'Themes to write about, and true experiences the drafts may use.'],
  ['config/voice.md', 'Voice', 'How your posts should sound.'],
  ['config/hashtags.md', 'Hashtags', 'Tags the drafts pick from.'],
  ['DRAFTING.md', 'Drafting instructions', 'Exactly what the Sunday task in the Claude app does.'],
];
function settingsView() {
  const s = structuredClone(state.settings);
  const slotRows = h('div', { class: 'stack' });
  const drawSlots = () => slotRows.replaceChildren(...s.slots.map((slot, i) => {
    const day = h('select', { 'aria-label': 'Day' }, DAYS.map((d) => h('option', { value: d, selected: d === slot.day }, d)));
    const time = h('input', { type: 'time', value: slot.time, 'aria-label': 'Time (UAE)' });
    day.addEventListener('change', () => { slot.day = day.value; });
    time.addEventListener('change', () => { slot.time = time.value; });
    return h('div', { class: 'row' }, day, time, h('button', { class: 'btn ghost', onclick: () => { s.slots.splice(i, 1); drawSlots(); }, 'aria-label': `Remove ${slot.day} ${slot.time}` }, 'Remove'));
  }));
  drawSlots();
  const perBatch = h('input', { type: 'number', min: 1, max: 5, value: s.postsPerBatch });
  const minLen = h('input', { type: 'number', min: 200, max: 3000, value: s.postLength.min });
  const maxLen = h('input', { type: 'number', min: 200, max: 3000, value: s.postLength.max });
  const banned = h('textarea', { rows: 4 }, s.bannedWords.join(', '));
  const guard = (fn) => async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { toast(err.message, true); } finally { b.disabled = false; } };
  const saveSettings = guard(async () => {
    s.postsPerBatch = Math.max(1, Math.min(5, Number(perBatch.value) || 3));
    s.postLength = { min: Number(minLen.value), max: Number(maxLen.value) };
    s.bannedWords = banned.value.split(',').map((w) => w.trim()).filter(Boolean);
    s.slots = s.slots.filter((x) => x.day && /^\d\d:\d\d$/.test(x.time));
    const res = await writeFile('config/settings.json', `${JSON.stringify(s, null, 2)}\n`, state.settingsSha, 'Update settings from the control desk');
    state.settings = s;
    state.settingsSha = res.content.sha;
    toast('Settings saved.');
    render();
  });

  const editors = CONFIG_FILES.map(([path, title, hint]) => {
    const area = h('textarea', { class: 'code', 'aria-label': title }, 'Loading…');
    let sha = null;
    if (state.demo) { area.value = DEMO.files[path] || ''; } else {
      readFile(path).then((f) => { area.value = f.text; sha = f.sha; }).catch((e) => { area.value = ''; toast(e.message, true); });
    }
    return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, title)),
      h('div', { class: 'panel-body stack' }, h('p', { class: 'hint' }, hint), area,
        h('div', {}, h('button', { class: 'btn secondary', onclick: guard(async () => { const res = await writeFile(path, area.value, sha, `Update ${path} from the control desk`); sha = res.content.sha; toast(`${title} saved.`); }) }, `Save ${title.toLowerCase()}`))));
  });

  return h('div', { class: 'stack' },
    h('div', { class: 'grid-2' },
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Publishing slots (UAE time)')),
        h('div', { class: 'panel-body stack' }, h('p', { class: 'hint' }, '"Next free slot" picks the earliest of these within the next 7 days.'), slotRows,
          h('div', {}, h('button', { class: 'btn ghost', onclick: () => { s.slots.push({ day: 'Mon', time: '09:00' }); drawSlots(); } }, '+ Add a slot')),
          h('label', { class: 'field' }, 'Drafts per Sunday batch', perBatch),
          h('div', { class: 'grid-2' }, h('label', { class: 'field' }, 'Shortest post (characters)', minLen), h('label', { class: 'field' }, 'Longest post (characters)', maxLen)),
          h('label', { class: 'field' }, 'Banned words (comma-separated)', banned),
          h('div', {}, h('button', { class: 'btn', onclick: saveSettings }, 'Save settings')))),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Control and access')),
        h('div', { class: 'panel-body stack' },
          h('p', {}, h('strong', {}, 'Automation switch: '), 'the switch at the top pauses every GitHub workflow at once. Drafts already scheduled in Publora still go out; cancel those in Publora.'),
          h('p', {}, h('strong', {}, 'Sunday drafts: '), 'run by the "LinkedIn drafts" task in the Claude app (Sundays 09:00, while the app is open). Turn it off there to stop new drafts.'),
          h('p', {}, h('strong', {}, 'Publishing key: '), 'the PUBLORA_API_KEY secret in the repo. Delete or revoke it to cut publishing off completely.'),
          h('div', { class: 'row' },
            h('a', { class: 'btn secondary', href: `https://github.com/${OWNER}/${REPO}/settings/secrets/actions`, target: '_blank', rel: 'noopener' }, 'Repo secrets'),
            h('a', { class: 'btn secondary', href: 'https://app.publora.com', target: '_blank', rel: 'noopener' }, 'Open Publora'),
            h('a', { class: 'btn ghost', href: `https://github.com/${OWNER}/${REPO}`, target: '_blank', rel: 'noopener' }, 'Open the repo')),
          h('p', { class: 'hint' }, 'Your token stays in this browser. Sign out (top right) to remove it from this device.')))),
    h('div', { class: 'grid-2' }, editors));
}

// ---------- start ----------
async function refresh() {
  try { await loadAll(); render(); } catch (e) { toast(e.message, true); }
}
async function start() {
  shell();
  document.getElementById('kpis').replaceChildren(h('p', { class: 'hint' }, 'Loading your posts from GitHub…'));
  try {
    await loadAll();
    render();
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem('gh-token'); sessionStorage.removeItem('gh-token'); state.token = null; signIn(); }
    toast(e.message, true);
  }
}

if (state.demo || state.token) start(); else signIn();
