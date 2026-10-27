// Fictional sample data for ?demo=1. Real drafts are never stored in this public repo.
const now = Date.now();
const iso = (days, hour = 4, minute = 30) => {
  const d = new Date(now + days * 86400000);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};
const day = (days) => new Date(now + days * 86400000).toISOString().slice(0, 10);
const sample = (lead) => `${lead}

This is sample text so you can see how the desk works. Real drafts load from your private repo after you sign in.

Open a card to edit the text, change the image lines, and approve it for the next free slot or a time you choose.

What would you want to see on this desk every Monday morning?

#SAP #S4HANA #GCC`;

const post = (path, meta, body) => ({ path, sha: `demo-${path}`, meta: { lint: '', postGroupId: '', scheduledTime: '', postedId: '', image_mode: 'card', ...meta }, body });

export const DEMO = {
  settings: {
    linkedinPlatformId: 'linkedin-demo', model: 'claude-opus-5-5', effort: 'high', postsPerBatch: 3, utcOffset: '+04:00',
    slots: [{ day: 'Tue', time: '08:30' }, { day: 'Wed', time: '08:30' }, { day: 'Thu', time: '08:30' }],
    maxHashtags: 6, postLength: { min: 900, max: 1300 }, commentLength: { min: 200, max: 350 },
    bannedWords: ['leverage', 'fundamentally', 'streamline', 'harness', 'delve', 'unlock', 'foster', 'game-changer', 'landscape', 'seamless'],
  },
  posts: [
    post(`posts/${day(0)}/3-sample-ariba.md`, { status: 'draft', created: day(0), angle: 'Sample: why users bypass catalog buying', image_file: '3.png', image_kicker: 'Sample · Ariba adoption', image_headline: 'Why users still choose *free text*', image_footer: 'Sample draft' }, sample('Guided buying is live, and requests still arrive as free text. (Sample draft.)')),
    post(`posts/${day(0)}/2-sample-grir.md`, { status: 'draft', created: day(0), angle: 'Sample: clean GR/IR before cut-over', image_file: '2.png', image_kicker: 'Sample · S/4HANA readiness', image_headline: 'Clean *GR/IR* before the mock load', image_footer: 'Sample draft' }, sample('Old GR/IR items turn into a cut-over problem. (Sample draft.)')),
    post(`posts/${day(-2)}/1-sample-scheduled.md`, { status: 'scheduled', created: day(-2), angle: 'Sample: scheduled post', image_file: '1.png', image_kicker: 'Sample · scheduled', image_headline: 'Who signs off the *mock load*?', image_footer: 'Sample', scheduledTime: iso(2) }, sample('A scheduled sample post.')),
    post(`posts/${day(-6)}/1-sample-published.md`, { status: 'published', created: day(-6), angle: 'Sample: published post', image_file: '1.png', image_kicker: 'Sample · published', image_headline: 'Which user approved this *PO*?', image_footer: 'Sample', scheduledTime: iso(-5) }, sample('A published sample post.')),
    post(`posts/${day(-6)}/2-sample-skipped.md`, { status: 'skipped', created: day(-6), angle: 'Sample: skipped draft', image_file: '2.png', image_kicker: 'Sample · skipped', image_headline: 'A draft you *skipped*', image_footer: 'Sample' }, sample('A skipped sample draft.')),
  ],
  comments: [
    { path: `comments/${day(-1)}/1-sample.md`, sha: 'demo-c1', meta: { status: 'posted', created: day(-1), postUrn: 'urn:li:activity:1', parentComment: '', lint: 'ok', commentUrn: '' }, body: 'A sample comment that was posted from the desk.' },
  ],
  runs: [
    { name: 'Draw images and send drafts to Publora', status: 'completed', conclusion: 'success', created: iso(0, new Date(now).getUTCHours()), url: '#' },
    { name: '2. Publish posts', status: 'completed', conclusion: 'success', created: iso(-2), url: '#' },
    { name: 'Draw images and send drafts to Publora', status: 'completed', conclusion: 'failure', created: iso(-3), url: '#' },
  ],
  files: {
    'config/topics.md': '# Topics\n\n(Sample) Your real topics load from the private repo after you sign in.\n',
    'config/voice.md': '# Voice\n\n(Sample) Your real voice rules load after you sign in.\n',
    'config/hashtags.md': '# Hashtags\n\n(Sample) #SAP #S4HANA #GCC\n',
    'DRAFTING.md': '# Drafting instructions\n\n(Sample) The real instructions load after you sign in.\n',
  },
};
