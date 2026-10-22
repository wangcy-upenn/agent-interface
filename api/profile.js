// Night Shift — POST /api/profile  { text }  -> profile JSON read from the resume
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash"; // match week3 api/quest.js if different

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return res.status(500).json({ error: "DEEPSEEK_API_KEY is not set in Vercel" });
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const text = String((body && body.text) || "").slice(0, 12000);
  if (text.length < 50) return res.status(400).json({ error: "Resume text is too short" });

  const system = `Read a resume and return JSON only:
{"name":string,"first":string,"last":string,"email":string|null,"phone":string|null,"linkedin":string|null,
"school":string (school, degree, graduation month and year, one line),
"targets":[string] (3-5 US job titles this person is a realistic new-grad fit for),
"evidence":[string] (5-7 concrete items copied from the resume: projects, internships, tools; keep their specifics),
"limits":string (one or two sentences: skills interviewers might assume that the resume does NOT support),
"keywords":[string] (4-6 short lowercase words to match job titles, e.g. "mechanical", "test")}
Use only what the resume says. Never invent experience.`;

  try {
    const out = await deepseek(key, system, text);
    out.targets = (out.targets || []).slice(0, 5); out.evidence = (out.evidence || []).slice(0, 7); out.keywords = (out.keywords || []).slice(0, 6);
    return res.status(200).json(out);
  } catch (e) { return res.status(502).json({ error: e.message }); }
};

async function deepseek(key, system, user) {
  const r = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" }, thinking: { type: "disabled" }, temperature: 0.3, max_tokens: 1500 })
  });
  if (!r.ok) throw new Error("DeepSeek " + r.status + ": " + (await r.text()).slice(0, 200));
  const d = await r.json(); const t = (d.choices && d.choices[0] && d.choices[0].message.content) || "{}";
  try { return JSON.parse(t); } catch (e) { const m = t.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error("AI did not return JSON"); }
}
