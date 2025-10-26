// server.js (ESM)

console.log("server.js path:", new URL(import.meta.url).pathname);
console.log("cwd:", process.cwd());

import "dotenv/config";
import express from "express";
import morgan from "morgan";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { LRUCache } from "lru-cache";
import { z } from "zod";

const app = express();

// middleware
app.use(cors({ origin: "*" }));            // relax for local dev; tighten later
app.use(express.json({ limit: "256kb" }));
app.use(morgan("tiny"));

// optional bearer auth for local dev if INTERNAL_API_KEY is set
app.use((req, res, next) => {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return next();
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Invalid `Authorization` header format. Must be `Bearer {apikey}`" });
  }
  const token = auth.slice(7);
  if (token !== expected) return res.status(401).json({ message: "Invalid API key" });
  next();
});

// Anthropic client (do not crash if missing)
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-haiku-latest";

// input schema
const classifyInput = z.object({
  url: z.string().url().optional().default(""),
  title: z.string().optional().default(""),
});

// cache by domain and simplified title
const cache = new LRUCache({
  max: 2000,
  ttl: 1000 * 60 * 60 * 24, // 24 hours
});

// policy prompt
const PRODUCTIVITY_POLICY = `
You are a strict productivity classifier for browsing activity.

Return ONLY valid JSON with keys:
- productive: boolean
- reason: string
- category: string // one of: "work","learning","utilities","communication","news","social","entertainment","shopping","adult","unknown"

Heuristics:
- Productive: docs, IDEs, coding Q&A, academic papers, LMS, email (work), calendar, dashboards, notes, task tools, StackOverflow, GitHub, Jupyter, LeetCode.
- Maybe: YouTube only if title implies tutorials or lectures; news only if researching a task.
- Not productive: social feeds, generic entertainment, shopping without clear work context, gaming, adult.
- Utilities (search engine home, blank new tab) = unknown.

If unsure, set productive=false.
`;

// helpers
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

// routes
app.get("/", (req, res) => {
  res.json({ 
    message: "Productivity Classifier API is running!",
    endpoints: {
      health: "/health",
      classify: "POST /classify",
      event: "POST /event"
    }
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.post("/classify", async (req, res) => {
  const parsed = classifyInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Bad input" });

  const { url, title } = parsed.data;
  const cacheKey = keyFrom(url, title);
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  if (!anthropic) {
    return res
      .status(500)
      .json({ error: "Server missing ANTHROPIC_API_KEY; set it in backend/.env" });
  }

  const domain = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "unknown";
    }
  })();

  const prompt = `URL: ${url}
Domain: ${domain}
Page Title: ${title}

Classify this visit. Return JSON only.`;

  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 200,
      temperature: 0,
      system: PRODUCTIVITY_POLICY,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg?.content?.[0]?.text || "";
    let parsedJson;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("No JSON in Claude response");
      parsedJson = JSON.parse(match[0]);
    }

    const shape = z.object({
      productive: z.boolean(),
      reason: z.string(),
      category: z.string(),
    });

    const result = shape.parse(parsedJson);
    cache.set(cacheKey, result);
    return res.json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Classification failed" });
  }
});

app.post("/event", (_req, res) => res.json({ ok: true }));

// Fish Audio TTS endpoint for berating messages
app.post("/berate", async (req, res) => {
  const { message, category } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    // Generate short, punchy insults using Claude AI
    const prompt = `You are Fish, a menacing productivity enforcer. Generate a SHORT, punchy, memorable insult for someone wasting time on ${category || 'entertainment'}.

Requirements:
- MAXIMUM 8-10 words
- Short and punchy
- Memorable and repeatable
- Funny but menacing
- NO asterisks or stage directions
- NO voice descriptions
- Just the insult itself

Examples:
- "Your productivity is dryer than a desert!"
- "Sloths work harder than you!"
- "Your goals are crying!"
- "Get back to work, slacker!"

Generate ONE short insult now:`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 100,
      temperature: 0.9, // High creativity
      messages: [{ role: "user", content: prompt }],
    });

    const aiMessage = msg?.content?.[0]?.text || "You're procrastinating! Get back to productive tasks!";
    console.log(`AI-generated berating message: ${aiMessage}`);

    // Return the AI-generated message
    res.json({
      message: aiMessage.trim(),
      category: category,
      ai_generated: true
    });

  } catch (error) {
    console.error('AI berating message generation error:', error);
    
    // Fallback to static messages if AI fails
    const fallbackMessages = {
      social: [
        "Your goals are crying!",
        "Sloths work harder than you!",
        "Get back to work, slacker!"
      ],
      entertainment: [
        "Your productivity is dryer than a desert!",
        "This video won't make you rich!",
        "Stop wasting time!"
      ],
      shopping: [
        "Your wallet is crying!",
        "Stop spending, start earning!",
        "Shopping won't pay bills!"
      ],
      news: [
        "News can wait!",
        "Stop doomscrolling!",
        "Focus on your work!"
      ]
    };

    const messages = fallbackMessages[category] || fallbackMessages.entertainment;
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];

    res.json({
      message: randomMessage,
      category: category,
      fallback: true
    });
  }
});

// AI-Generated hateful memes endpoint
app.post("/generate-meme", async (req, res) => {
  const { category } = req.body;

  try {
    const prompt = `Generate a hateful, sarcastic meme about productivity and staying focused. Make it brutally honest and funny. The user is currently distracted by ${category || 'entertainment'}. 

Return ONLY the meme text, no explanations. Make it sound like a viral meme format.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 150,
      temperature: 0.8,
      messages: [{ role: "user", content: prompt }],
    });

    const memeText = msg?.content?.[0]?.text || "WHEN YOU'RE SUPPOSED TO BE WORKING BUT YOU'RE ON YOUTUBE AGAIN";

    res.json({
      meme: memeText.trim(),
      category: category || 'entertainment'
    });

  } catch (error) {
    console.error('Meme generation error:', error);
    // Fallback memes
    const fallbackMemes = [
      "WHEN YOU'RE SUPPOSED TO BE WORKING BUT YOU'RE ON YOUTUBE AGAIN",
      "ME: I'll just watch one video\nALSO ME: *watches 47 videos*",
      "PRODUCTIVITY LEVEL: 📉📉📉📉📉",
      "YOUR BRAIN: Let's be productive!\nYOUR HANDS: *opens YouTube*"
    ];
    
    res.json({
      meme: fallbackMemes[Math.floor(Math.random() * fallbackMemes.length)],
      category: category || 'entertainment',
      fallback: true
    });
  }
});

// start server
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "127.0.0.1";

const server = app.listen(PORT, HOST, () => {
  console.log(`Backend on http://${HOST}:${PORT}`);
});