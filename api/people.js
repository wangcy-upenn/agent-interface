// Night Shift — find real people on LinkedIn for a job.
// GET  /api/people -> { ok: true } when SERPER_API_KEY is set
// POST /api/people { company, people:[{type,title,why,hook}] } -> { people:[{name, headline, url, type, why, hook}] }
// Uses a web search for public LinkedIn profile pages (the same results you'd get searching Google yourself).
// It only returns the public name, headline and profile link shown in the search result. Nothing is scraped from LinkedIn.

module.exports = async (req, res) => {
  const key = process.env.SERPER_API_KEY;
  if (req.method === "GET") return res.status(200).json({ ok: !!key });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!key) return res.status(500).json({ error: "SERPER_API_KEY is not set in Vercel" });

  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const company = String((body && body.company) || "").trim();
  const wanted = Array.isArray(body && body.people) ? body.people.slice(0, 5) : [];
  if (!company || !wanted.length) return res.status(400).json({ error: "company and people are required" });

  async function search(q) {
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q, gl: "us", num: 10 })
    });
    if (!r.ok) throw new Error("search " + r.status);
    const d = await r.json();
    return (d.organic || []).filter(o => /linkedin\.com\/in\//i.test(o.link || ""));
  }
  function parse(o) {
    // "Jane Doe - NPI Engineer - Formlabs | LinkedIn"
    const t = String(o.title || "").replace(/\s*\|\s*LinkedIn.*$/i, "").replace(/\s*-\s*LinkedIn.*$/i, "").trim();
    const parts = t.split(/\s+[-–|]\s+/);
    const name = (parts.shift() || "").replace(/,.*$/, "").trim();
    const headline = parts.join(" · ").trim();
    return { name, headline, snippet: String(o.snippet || "").slice(0, 200), url: String(o.link).split("?")[0] };
  }
  const coRe = new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").split(/\s+/)[0], "i");

  try {
    const lists = await Promise.all(wanted.map(p => {
      const alum = /alum/i.test(p.type || "");
      const title = String(p.title || "").split(/\s+/).slice(0, 4).join(" ");
      const q = `site:linkedin.com/in "${company}" ${title}${alum ? ' "University of Pennsylvania"' : ""}`;
      return search(q).catch(() => []);
    }));
    const used = new Set(), out = [];
    wanted.forEach((p, i) => {
      // prefer someone whose result actually mentions the company
      const cands = lists[i].map(parse).filter(x => x.name && x.name.length < 60 && !used.has(x.url));
      const pick = cands.find(x => coRe.test(x.headline + " " + x.snippet)) || cands[0];
      if (!pick) return;
      used.add(pick.url);
      out.push({ ...pick, type: p.type || "Contact", why: p.why || "", hook: p.hook || "", title: p.title || "" });
    });
    return res.status(200).json({ people: out });
  } catch (e) { return res.status(502).json({ error: e.message }); }
};
