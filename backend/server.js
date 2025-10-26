// ================================
// 🧠 Productivity Tracker Backend (server.js)
// ================================

import "dotenv/config";
import express from "express";
import morgan from "morgan";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { LRUCache } from "lru-cache";
import { z } from "zod";

const app = express();

// ---- Middleware ----
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "256kb" }));
app.use(morgan("tiny"));

// Optional dev auth
app.use((req, res, next) => {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return next();
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Missing or invalid `Authorization` header" });
  }
  if (auth.slice(7) !== expected) {
    return res.status(401).json({ message: "Invalid API key" });
  }
  next();
});

// ---- Anthropic Setup ----
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-haiku-latest";

// ---- Cache ----
const cache = new LRUCache({ max: 2000, ttl: 1000 * 60 * 60 * 24 });

// ---- Schema ----
const classifyInput = z.object({
  url: z.string().url().optional().default(""),
  title: z.string().optional().default(""),
});

// ---- Claude System Prompt ----
const PRODUCTIVITY_POLICY = `
You are a strict productivity classifier.

Return ONLY valid JSON:
{
  "productive": boolean,
  "reason": string,
  "category": string // one of: "work","learning","utilities","communication","news","social","entertainment","shopping","adult","unknown"
}

Heuristics:
- Productive: docs, IDEs, Q&A, academic, LMS, email, task managers, GitHub, LeetCode.
- Maybe: YouTube only if tutorial/lecture.
- Not productive: entertainment, social, shopping, adult.
- Utilities (search, blank tabs) = unknown.
If unsure, productive=false.
`;

// ---- Helper ----
function cacheKey(url, title) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}::${title?.toLowerCase() || ""}`;
  } catch {
    return `unknown::${title?.toLowerCase() || ""}`;
  }
}

// ---- Routes ----
app.get("/", (_, res) =>
  res.json({
    message: "✅ Productivity API running",
    endpoints: ["/classify", "/berate", "/generate-meme", "/punish"],
  })
);

app.get("/health", (_, res) => res.json({ ok: true }));

// ---- Classification ----
app.post("/classify", async (req, res) => {
  const parsed = classifyInput.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input" });

  const { url, title } = parsed.data;
  const key = cacheKey(url, title);
  if (cache.has(key)) return res.json(cache.get(key));

  if (!anthropic)
    return res.status(500).json({ error: "Missing Anthropic API key" });

  const prompt = `URL: ${url}\nTitle: ${title}\nClassify this page.`;
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: PRODUCTIVITY_POLICY,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg?.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsedJson = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    const result = z
      .object({
        productive: z.boolean(),
        reason: z.string(),
        category: z.string(),
      })
      .parse(parsedJson);

    cache.set(key, result);
    res.json(result);
  } catch (err) {
    console.error("Classification failed:", err);
    res.status(500).json({ error: "Classification failed" });
  }
});

// ---- Berating Endpoint ----
app.post("/berate", async (req, res) => {
  const { category = "entertainment" } = req.body;
  try {
    const prompt = `Generate a SHORT (≤10 words), punchy insult for wasting time on ${category}.
Examples: "Your goals are crying!", "Sloths work harder than you!"
Return just the insult text.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 50,
      temperature: 0.9,
      messages: [{ role: "user", content: prompt }],
    });

    const insult =
      msg?.content?.[0]?.text?.trim() ||
      "You're procrastinating! Get back to work!";
    res.json({ message: insult, category });
  } catch (e) {
    console.error("Berate error:", e);
    res.json({ message: "Stop wasting time!", category, fallback: true });
  }
});

// ---- Meme Endpoint ----
app.post("/generate-meme", async (req, res) => {
  const { category } = req.body;
  try {
    const prompt = `Generate a brutally honest meme about being distracted by ${category}.
Return only the meme text.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 150,
      temperature: 0.8,
      messages: [{ role: "user", content: prompt }],
    });

    res.json({
      meme: msg?.content?.[0]?.text?.trim() ||
        "WHEN YOU'RE SUPPOSED TO WORK BUT YOU'RE ON YOUTUBE AGAIN",
      category,
    });
  } catch (e) {
    console.error("Meme generation failed:", e);
    res.json({
      meme: "PRODUCTIVITY LEVEL: 📉📉📉",
      category,
      fallback: true,
    });
  }
});

// ---- 💸 Money Punishment Endpoint ----
app.post("/punish", async (req, res) => {
  const { user = "anonymous", amount = 0.25 } = req.body;
  console.log(`💸 Punishment: deduct $${amount} from ${user}`);
  // In production, you’d hook up to Stripe or a mock balance here.
  res.json({
    user,
    deducted: amount,
    new_balance: Math.max(0, 10 - amount), // mock static base $10
  });
});

// ---- Start Server ----
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`🚀 Backend running at http://${HOST}:${PORT}`);
});
