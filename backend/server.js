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

  // Generate berating messages based on category
  const beratingMessages = {
    social: [
      "Stop wasting time on social media! Get back to work!",
      "You're supposed to be productive, not scrolling through feeds!",
      "Social media can wait! Focus on your goals!",
      "Put down the phone and pick up your work!"
    ],
    entertainment: [
      "This isn't helping you achieve your goals!",
      "Entertainment can wait until you're done with work!",
      "You're procrastinating! Get back to productive tasks!",
      "Focus! This video isn't going anywhere!"
    ],
    shopping: [
      "Stop shopping and start working!",
      "Your wallet and productivity will thank you later!",
      "Shopping can wait! Focus on earning first!",
      "Put the cart down and pick up your tasks!"
    ],
    news: [
      "News can wait! Your work can't!",
      "Stop doomscrolling and start working!",
      "The news will still be there when you're done!",
      "Focus on what you can control - your work!"
    ]
  };

  const messages = beratingMessages[category] || beratingMessages.entertainment;
  const randomMessage = messages[Math.floor(Math.random() * messages.length)];
  
  try {
    // For now, let's use a simple text-to-speech approach
    // You can replace this with actual Fish Audio API when you have the correct endpoint
    console.log(`Berating message: ${randomMessage}`);
    
    // Return the message as text for now - the extension can use Web Speech API
    res.json({ 
      message: randomMessage,
      category: category,
      fallback: true 
    });
    
  } catch (error) {
    console.error('Audio generation error:', error);
    // Fallback: return a simple text response
    res.json({ 
      error: "Audio generation failed", 
      message: randomMessage,
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