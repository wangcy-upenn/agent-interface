// Night Shift — per-job agent.
// GET  /api/agent  -> { ok: true } when DEEPSEEK_API_KEY is set (the page uses this to choose live vs sample mode)
// POST /api/agent  { job, profile } -> { fit, fit_reason, cover_letter, people[], hold_question }
// Nothing is ever submitted from here. Sponsorship / salary questions are flagged for the person, never answered.

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash"; // match week3 api/quest.js if different

module.exports = async (req, res) => {
  const key = process.env.DEEPSEEK_API_KEY;
  if (req.method === "GET") return res.status(200).json({ ok: !!key, model: MODEL });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!key) return res.status(500).json({ error: "DEEPSEEK_API_KEY is not set in Vercel" });

  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const job = (body && body.job) || {}, p = (body && body.profile) || {};
  if (!job.posting) return res.status(400).json({ error: "job.posting is required" });

  const system = `You help one candidate apply to US jobs. For the posting you get:
1. fit: 0-100 against the candidate's targets and evidence. Clearly missed hard requirements (years, licenses, clearance) mean under 50. fit_reason: one plain sentence to the candidate, second person.
2. cover_letter: under 180 words, first person, signed with the candidate's full name. Tie 2-3 specific requirements from THIS job description to the candidate's real evidence. Use only the evidence given; never invent experience. Plain and specific: no flattery, no "I am excited to", no em dashes.
3. people: 3 to 5 KINDS of people worth a LinkedIn coffee chat for this job. Never invent real names. Mix: Penn alumni in this role or company, the company's university or technical recruiter, an engineer on the likely team, and optionally a hiring manager type. For each: type ("Penn alumni" | "Recruiter" | "Team engineer" | "Hiring manager" | "Researcher"), who (one line), does (what they do, one sentence), why (why a coffee chat helps for this job, one sentence), title (the job title to search for, 2-4 words, no company name, e.g. "NPI engineer", "university recruiter", "manufacturing engineering manager"), hook (one sentence the candidate would say when asking for a chat).
5. work_auth: read the job description for work-authorization rules. cpt, opt, h1b: "yes" if it says that is accepted or sponsored, "no" if it rules it out (e.g. no sponsorship now or in the future, U.S. citizens or U.S. persons only, security clearance, ITAR), "unknown" if it doesn't say. us_only: true if it requires U.S. citizenship, U.S. person status or a clearance. ndaa: true if it restricts citizens of NDAA countries of concern (China, Iran, Russia, North Korea). evidence: the shortest exact quote from the JD that supports this, or null.
4. hold_question: if the posting or its application likely asks about visa sponsorship, work authorization or salary, write that question; otherwise null.
Also return company, role and place read from the posting (short).
Reply with JSON only:
{"company":string,"role":string,"place":string,"fit":number,"fit_reason":string,"cover_letter":string,"people":[{"type":string,"who":string,"does":string,"why":string,"title":string,"hook":string}],"hold_question":string|null,"work_auth":{"cpt":string,"opt":string,"h1b":string,"us_only":boolean,"ndaa":boolean,"evidence":string|null}}`;

  const user = `CANDIDATE
Name: ${p.name || ""}
School: ${p.school || ""}
Targets: ${(p.targets || []).join("; ")}
Evidence:
- ${(p.evidence || []).join("\n- ")}
Limits: ${p.limits || ""}

JOB
${job.company || ""} — ${job.role || ""} — ${job.place || ""}
${String(job.posting).slice(0, 6000)}`;

  try {
    const out = await deepseek(key, system, user);
    out.fit = clamp(Math.round(Number(out.fit) || 0), 0, 100);
    out.cover_letter = String(out.cover_letter || "").trim();
    out.people = (Array.isArray(out.people) ? out.people : []).slice(0, 5).map(x => ({
      type: String(x.type || "Contact"), who: String(x.who || ""), does: String(x.does || ""), why: String(x.why || ""),
      title: String(x.title || "").split(/\s+/).slice(0, 4).join(" "), hook: String(x.hook || "") }));
    if (!out.hold_question && /sponsor|visa|work authori[sz]ation|salary|compensation/i.test(job.posting)) {
      out.hold_question = "Will you now or in the future require visa sponsorship?";
    }
    const wa = out.work_auth || {}, v = x => (["yes", "no", "unknown"].includes(x) ? x : "unknown");
    out.work_auth = { cpt: v(wa.cpt), opt: v(wa.opt), h1b: v(wa.h1b), us_only: !!wa.us_only, ndaa: !!wa.ndaa, evidence: wa.evidence ? String(wa.evidence).slice(0, 300) : null };
    if (!out.cover_letter) return res.status(502).json({ error: "The AI returned no cover letter" });
    return res.status(200).json(out);
  } catch (e) { return res.status(502).json({ error: e.message }); }
};

async function deepseek(key, system, user) {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" }, thinking: { type: "disabled" }, temperature: 0.5, max_tokens: 2000 })
  });
  if (!r.ok) throw new Error("DeepSeek " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json(); const t = (d.choices && d.choices[0] && d.choices[0].message.content) || "{}";
  try { return JSON.parse(t); } catch (e) { const m = t.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error("AI did not return JSON"); }
}
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
