# Night Shift

Finds US jobs on official career pages, writes a cover letter from each job description, suggests people to contact on LinkedIn, and lets you decide whether to apply. Nothing is ever submitted for you.

- `index.html` — the page
- `api/search.js` — searches Greenhouse / Ashby / Lever career pages, US jobs only
- `api/agent.js` — fit score, cover letter, LinkedIn contacts (DeepSeek)
- `api/profile.js` — reads your resume (DeepSeek)
- `vercel.json` — gives the API up to 60 seconds

Vercel environment variable: `DEEPSEEK_API_KEY` (optional: `DEEPSEEK_MODEL`, default `deepseek-flash`).
