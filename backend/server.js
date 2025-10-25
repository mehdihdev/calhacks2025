import "dotenv/config";
import express from "express";
import morgan from "morgan";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import LRU from "lru-cache";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(morgan("tiny"));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const PORT = process.env.PORT || 4000;

const classifyInput = z.object({
  url: z.string().url().optional().default(""),
  title: z.string().optional().default("")
});

// Cache by domain + simplified title
const cache = new LRU({ max: 2000, ttl: 1000 * 60 * 60 * 24 }); // 24h

const PRODUCTIVITY_POLICY = `
You are a strict productivity classifier for browsing activity.

Return ONLY valid JSON with keys:
- productive: boolean                // true if content likely supports focused work/study
- reason: string                     // short justification
- category: string                   // one of: "work", "learning", "utilities", "communication", "news", "social", "entertainment", "shopping", "adult", "unknown"

Heuristics (favor precision; false positives are costly):
- Productive: docs, IDEs, coding Q&A, academic papers, LMS, email (work), calendar, dashboards, notes, task tools, StackOverflow, GitHub, Jupyter, LeetCode (practice).
- Maybe: YouTube only if title implies tutorials/lectures; news only if researching a task.
- Not productive: feeds (TikTok, Instagram, X), generic YouTube/entertainment, shopping without clear work context, gaming, adult.
- Utilities (search engine home, blank new tab) = unknown (non-productive by default).

If unsure, set productive=false.
`;

// Minimal normalizer
function keyFrom(url, title) {
  try {
    const u = new URL(url || "http://unknown/");
    const domain = u.hostname.replace(/^www\./, "");
    const t = (title || "").toLowerCase().replace(/\s+/g, " ").trim();
    return `${domain}::${t || "(untitled)"}`;
  } catch {
    const t = (title || "").toLowerCase().replace(/\s+/g, " ").trim();
    return `unknown::${t || "(untitled)"}`;
  }
}

app.post("/classify", async (req, res) => {
  const parsed = classifyInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad input" });

  const { url, title } = parsed.data;
  const cacheKey = keyFrom(url, title);
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const domain = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "unknown"; }
  })();

  const prompt = `
URL: ${url}
Domain: ${domain}
Page Title: ${title}

Classify this visit. Return JSON only.
`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 200,
      temperature: 0,
      system: PRODUCTIVITY_POLICY,
      messages: [{ role: "user", content: prompt }]
    });

    // Extract the JSON block robustly
    const text = msg.content?.[0]?.text || "";
    let parsedJson;
    try { parsedJson = JSON.parse(text); }
    catch {
      // Fallback: pull first {...} block
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON in Claude response");
      parsedJson = JSON.parse(match[0]);
    }

    const shape = z.object({
      productive: z.boolean(),
      reason: z.string(),
      category: z.string()
    });

    const result = shape.parse(parsedJson);
    cache.set(cacheKey, result);
    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Classification failed" });
  }
});

// Optional: event logging endpoint (no DB; swap with your store later)
app.post("/event", (req, res) => {
  // You could write to a file or DB here. For scaffold, just 200 OK.
  res.json({ ok: true });
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Backend on :${PORT}`);
});
