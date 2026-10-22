// Night Shift — GET /api/search?companies=a,b&keywords=x,y&limit=6
// Searches each company's public job board (Greenhouse, then Ashby, then Lever),
// keeps US roles only, ranks them by your keywords, and returns the top few.
// No API key needed: these are the same public feeds the companies' own career pages use.

const STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" ");
const STATE_NAMES = ["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming"];
const US_RE = new RegExp("united states|\\busa\\b|\\bu\\.s\\.|\\bus\\b|remote\\s*[-,(]?\\s*us|" + STATE_NAMES.join("|") + "|,\\s*(" + STATES.join("|") + ")\\b", "i");

function isUS(loc, country) {
  if (country && /^(us|usa|united states)$/i.test(String(country).trim())) return true;
  return US_RE.test(String(loc || ""));
}
function decode(s) {
  return String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
function plain(html) {
  return decode(decode(html)).replace(/<\/(p|li|h\d|div)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function pretty(slug) {
  return slug.replace(/industries$|inc$|careers$/i, "").replace(/^fly/, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim() || slug;
}
async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": "NightShift-class-prototype" } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

async function greenhouse(slug) {
  const [board, data] = await Promise.all([
    getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}`).catch(() => ({})),
    getJSON(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`)
  ]);
  if (!Array.isArray(data.jobs)) throw new Error("no jobs");
  const company = board.name || (data.jobs[0] && data.jobs[0].company_name) || pretty(slug);
  return { ats: "Greenhouse", company, jobs: data.jobs.map(j => ({
    id: "gh-" + j.id, company, role: j.title, place: (j.location && j.location.name) || "",
    us: isUS(j.location && j.location.name), url: j.absolute_url, posting: plain(j.content) })) };
}
async function ashby(slug) {
  const data = await getJSON(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
  if (!Array.isArray(data.jobs)) throw new Error("no jobs");
  const company = pretty(slug);
  return { ats: "Ashby", company, jobs: data.jobs.filter(j => j.isListed !== false).map(j => {
    const country = j.address && j.address.postalAddress && j.address.postalAddress.addressCountry;
    return { id: "ab-" + j.id, company, role: j.title, place: j.location || "", us: isUS(j.location, country),
      url: j.applyUrl || j.jobUrl, posting: j.descriptionPlain || plain(j.descriptionHtml) };
  }) };
}
async function lever(slug) {
  const data = await getJSON(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!Array.isArray(data)) throw new Error("no jobs");
  const company = pretty(slug);
  return { ats: "Lever", company, jobs: data.map(j => {
    const loc = (j.categories && j.categories.location) || "";
    return { id: "lv-" + j.id, company, role: j.text, place: loc, us: isUS(loc, j.country),
      url: j.applyUrl || j.hostedUrl, posting: j.descriptionPlain || plain(j.description) };
  }) };
}
async function board(slug) {
  for (const f of [greenhouse, ashby, lever]) {
    try { const b = await f(slug); if (b.jobs.length) return b; } catch (e) { /* try the next board type */ }
  }
  throw new Error("no public board found");
}

const SENIOR = /\b(senior|sr\.?|staff|principal|director|manager|head of|lead|vp|chief)\b/i;
const JUNIOR = /\b(new grad|early career|entry|associate|university|graduate|intern|i\b|1\b)/i;

module.exports = async (req, res) => {
  const q = req.query || {};
  const slugs = String(q.companies || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 12);
  const kws = String(q.keywords || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const limit = Math.min(10, Math.max(1, parseInt(q.limit, 10) || 6));
  if (!slugs.length) return res.status(400).json({ error: "Add at least one company" });

  const settled = await Promise.all(slugs.map(s => board(s).then(b => ({ slug: s, ...b }), e => ({ slug: s, error: e.message }))));
  const boards = [], pool = [];
  for (const b of settled) {
    if (b.error) { boards.push({ company: b.slug, error: "no public board found" }); continue; }
    const us = b.jobs.filter(j => j.us);
    let matched = 0;
    for (const j of us) {
      const title = j.role.toLowerCase(), body = j.posting.toLowerCase();
      let score = 0;
      for (const k of kws) { if (title.includes(k)) score += 3; else if (body.includes(k)) score += 0.5; }
      if (SENIOR.test(j.role)) score -= 6;
      if (JUNIOR.test(j.role)) score += 2;
      if (/intern\b/i.test(j.role)) score -= 1; // full-time roles first; interns still allowed
      if (kws.some(k => title.includes(k))) { matched++; if (score > 0) pool.push({ ...j, score }); }
    }
    boards.push({ company: b.company, ats: b.ats, total: b.jobs.length, us: us.length, matched });
  }
  // best first, but spread across companies so one big board doesn't take every slot
  pool.sort((a, b) => b.score - a.score);
  const picked = [], perCo = {};
  for (const j of pool) {
    if (picked.length >= limit) break;
    if ((perCo[j.company] || 0) >= 2) continue;
    perCo[j.company] = (perCo[j.company] || 0) + 1;
    picked.push({ id: j.id, company: j.company, role: j.role, place: j.place, url: j.url, posting: j.posting.slice(0, 4000), source: "board" });
  }
  res.setHeader("Cache-Control", "s-maxage=600");
  return res.status(200).json({ boards, jobs: picked });
};
