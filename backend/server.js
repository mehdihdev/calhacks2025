import "dotenv/config";
import express from "express";
import morgan from "morgan";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { LRUCache } from "lru-cache";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(morgan("tiny"));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in environment.");
  process.exit(1);
}
const MODEL = process.env.CLAUDE_MODEL; // e.g., claude-3-7-sonnet-20250219
if (!MODEL) {
  console.error("Missing CLAUDE_MODEL in environment. Set a concrete model id returned by /v1/models.");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const PORT = process.env.PORT || 4000;

const classifyInput = z.object({
  url: z.string().url().or(z.literal("")).optional().default(""),
  title: z.string().optional().default("")
});

const cache = new LRUCache({ max: 2000, ttl: 1000 * 60 * 60 * 24 }); // 24h

const PRODUCTIVITY_POLICY = `
You are a strict productivity classifier for browsing activity.

Return ONLY valid JSON with keys:
- productive: boolean
- reason: string
- category: string  // one of: "work", "learning", "utilities", "communication", "news", "social", "entertainment", "shopping", "adult", "unknown"

Heuristics (favor precision; false positives are costly):
- Productive: docs, IDEs, coding Q&A, academic papers, LMS, email (work), calendar, dashboards, notes, task tools, StackOverflow, GitHub, Jupyter, LeetCode (practice).
- Maybe: YouTube only if title implies tutorials/lectures; news only if researching a task.
- Not productive: feeds (TikTok, Instagram, X), generic YouTube/entertainment, shopping without clear work context, gaming, adult.
- Utilities (search engine home, blank new tab) = unknown (non-productive by default).

If unsure, set productive=false.
Strictly output only JSON, with no extra text before or after.
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
`.trim();

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      temperature: 0,
      system: PRODUCTIVITY_POLICY,
      messages: [{ role: "user", content: prompt }]
    });

    const block = msg.content?.[0];
    const text = block && block.type === "text" ? block.text : "";
    if (!text || !text.trim()) {
      console.error("Empty/invalid Claude response:", JSON.stringify(msg, null, 2));
      return res.status(502).json({ error: "Empty Claude response" });
    }

    // Try strict parse; fall back to first {...}
    let parsedJson;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        console.error("No JSON found in response text:", text);
        return res.status(502).json({ error: "Claude did not return JSON" });
      }
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
    const status = e.status ?? e.statusCode ?? 500;
    const detail = e.error ?? e.message ?? String(e);
    console.error("Anthropic error:", {
      status,
      detail,
      data: e?.response?.data || e?.body || null,
    });
    return res.status(500).json({ error: "Classification failed", detail });
  }
});

app.post("/event", (_req, res) => {
  res.json({ ok: true });
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Backend on :${PORT}`);
});
