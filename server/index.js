const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const Groq = require("groq-sdk");

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const allowedOrigins = [
  "https://studyflow-ai-kappa.vercel.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "http://localhost:3001",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow non-browser requests or same-origin requests with no origin header
    if (!origin) return callback(null, true);

    const isExplicitlyAllowed = allowedOrigins.includes(origin);
    const isVercelDeployment =
      origin === "https://studyflow-ai-kappa.vercel.app" ||
      /^https:\/\/studyflow-ai[a-z0-9-]*\.vercel\.app$/.test(origin) ||
      /^https:\/\/.*\.vercel\.app$/.test(origin);

    if (isExplicitlyAllowed || isVercelDeployment) {
      return callback(null, true);
    }

    // Default allow to ensure production requests are not erroneously blocked
    return callback(null, true);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "2mb" }));

// Check that the Groq API key exists
if (!process.env.GROQ_API_KEY) {
  console.error("GROQ_API_KEY is missing. Check your server/.env file.");
  process.exit(1);
}

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

// Backend health check
app.get("/", (req, res) => {
  res.json({
    message: "StudyFlow AI backend is running!",
    model: GROQ_MODEL,
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "StudyFlow AI backend is healthy!",
    model: GROQ_MODEL,
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// CONCURRENCY QUEUE & RATE LIMIT PROTECTION
// ============================================

// Serialized queue to prevent concurrent Groq requests from blowing TPM limits
let isProcessing = false;
const requestQueue = [];

function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;
  const { fn, resolve, reject } = requestQueue.shift();

  fn()
    .then(resolve)
    .catch(reject)
    .finally(() => {
      isProcessing = false;
      // Subtle 400ms pause between requests to prevent burst spikes
      setTimeout(processQueue, 400);
    });
}

function enqueueRequest(fn) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject });
    processQueue();
  });
}

/**
 * Execute a Groq completion with concurrency safety and 1 automatic retry on rate limit.
 */
async function callGroqWithRetry(params, maxRetries = 1) {
  return enqueueRequest(async () => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await groq.chat.completions.create(params);
      } catch (error) {
        const status = error?.status;
        const msg = (error?.message || error?.error?.message || "").toLowerCase();
        const isRateLimit =
          status === 429 ||
          status === 413 ||
          msg.includes("rate limit") ||
          msg.includes("tokens per minute") ||
          msg.includes("tpm");

        if (isRateLimit && attempt < maxRetries) {
          console.warn(
            `Groq rate limit hit. Pausing 2.5s before retry (attempt ${attempt + 1}/${maxRetries})...`
          );
          await new Promise((resolve) => setTimeout(resolve, 2500));
          continue;
        }
        throw error;
      }
    }
  });
}

// ============================================
// TOKEN & TEXT SAFEGUARDS
// ============================================

// Model TPM limit: 8,000.
// Single call safe budget: ~1,500 input tokens (~5,500 chars) + ~1,000 completion tokens = ~2,500 tokens (well under 8,000).
const SINGLE_CHUNK_MAX_CHARS = 5500;
const TWO_CHUNK_MAX_CHARS = 12000;
const ABSOLUTE_MAX_TEXT_CHARS = 100000;

const TASK_OUTPUT_TOKEN_LIMITS = {
  summarize: 1100,
  topics: 950,
  mcqs: 1100,
  revision: 1000,
  ask: 850,
};

/**
 * Strips outer ```markdown ... ``` fences if the model wraps its whole output.
 */
function cleanAIOutput(text) {
  if (!text || typeof text !== "string") return "";
  let cleaned = text.trim();
  const outerFence = cleaned.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  if (outerFence) {
    cleaned = outerFence[1].trim();
  }
  return cleaned;
}

/**
 * Prepares study material text according to size:
 * - If <= 5,500 chars: full text
 * - If > 12,000 chars: samples representative beginning, middle, and end, with note.
 */
function prepareSampledMaterial(rawText) {
  if (!rawText || typeof rawText !== "string") return { text: "", isSampled: false };
  const trimmed = rawText.trim();
  if (trimmed.length <= SINGLE_CHUNK_MAX_CHARS) {
    return { text: trimmed, isSampled: false };
  }

  // Large document: extract beginning, middle, and ending sections
  const headLength = 3200;
  const midLength = 1600;
  const tailLength = 2200;

  const head = trimmed.slice(0, headLength);
  const midIndex = Math.floor(trimmed.length / 2);
  const mid = trimmed.slice(midIndex - Math.floor(midLength / 2), midIndex + Math.floor(midLength / 2));
  const tail = trimmed.slice(-tailLength);

  const sampled = `${head}\n\n[... Core Section Extract ...]\n\n${mid}\n\n[... Concluding Section Extract ...]\n\n${tail}`;
  return { text: sampled, isSampled: true };
}

// Common formatting instructions injected into prompts
const FORMATTING_RULES = `
CRITICAL FORMATTING GUIDELINES:
- Output clean Markdown directly. Do NOT wrap the entire response in a markdown code fence (\`\`\`markdown ... \`\`\`).
- Always put a space after '#' for headings (e.g., '## Section Title', never '##Section Title').
- Always leave an empty line before and after headings, bullet lists, tables, and dividers.
- Do NOT use raw HTML tags such as <br>, <div>, or <span>. Use standard Markdown line breaks and paragraphs.
- Keep bold syntax clean (e.g. '**Term**: Definition').
`;

function getPrompt(task, processedText, cleanQuestion, requestedCount = 5) {
  const prompts = {
    summarize: `You are an expert study assistant for StudyFlow AI.
Generate a comprehensive, beautifully structured study summary from the provided study material.
Write in clear, student-friendly Markdown using this structural outline:

# Study Summary

## Overview
A short, clear overview explaining the main subject, context, and core purpose of the material.

## Key Concepts
Explain the foundational concepts under distinct subheadings (### Concept Name) with step-by-step clarity.

## Important Definitions
- **Term**: Precise definition and why it matters.

## Examples & Applications
Include clear, practical examples from or directly relevant to the material that clarify complex ideas.

## Important Formulas & Rules
Include mathematical formulas, scientific laws, or syntax rules only if present in or directly relevant to the material. (Omit if not applicable).

## Key Takeaways
Concise bullet points highlighting the most essential exam takeaways.

## Conclusion
A brief synthesis summarizing the broader significance of the material.

${FORMATTING_RULES}
- Base your summary strictly on the uploaded text. Do not invent unsupported claims.
- Do NOT use giant tables.

STUDY MATERIAL:
${processedText}`,

    topics: `You are an expert curriculum analyst for StudyFlow AI.
Analyze the following study material and identify the main topics and their conceptual difficulty.
Output clean, consistent Markdown with individual topic sections. Do NOT use giant markdown tables.

# Topics & Difficulty Analysis

A brief overview of the topics covered in this material.

---

## 1. [Topic Name]

**Difficulty:** [Easy | Medium | Hard]

**Why this difficulty:** [Brief explanation of why this difficulty was assigned based on conceptual depth or prerequisites.]

**What it covers:** [A short, clear explanation of the key ideas and mechanisms in this topic.]

**Key Subtopics:**
- [Subtopic 1]: [Brief note]
- [Subtopic 2]: [Brief note]
- [Subtopic 3]: [Brief note]

**Study tip:** [A practical, actionable tip for mastering this topic.]

---

Repeat this clean format for every main topic found in the material.

${FORMATTING_RULES}
- Base topics strictly on the uploaded material.
- Do NOT put the analysis into one giant table.

STUDY MATERIAL:
${processedText}`,

    mcqs: `You are an expert exam creator for StudyFlow AI.
Create a high-quality practice quiz based exclusively on the provided study material.
Generate EXACTLY ${requestedCount} multiple-choice questions numbered Question 1 to Question ${requestedCount}.

Output in clean, consistent Markdown with this exact structure for each question:

# Practice Quiz

A brief 1-2 sentence description of what this ${requestedCount}-question quiz tests.

---

### Question 1
[Clear, unambiguous question text]

A. [Option A text]
B. [Option B text]
C. [Option C text]
D. [Option D text]

**Correct answer:** [Letter]. [Option text, e.g. B. Option B text]

**Explanation:** [Clear explanation of why this option is correct and why other alternatives are incorrect.]

---

### Question 2
...
(Continue for all ${requestedCount} questions. You MUST generate all ${requestedCount} questions from Question 1 to Question ${requestedCount} without stopping early.)

${FORMATTING_RULES}
- EXACTLY ${requestedCount} questions must be generated.
- Each question must have four distinct options (A, B, C, D) on separate lines.
- Exactly one option must be correct.
- Stated correct answer must match the explanation.
- Separate each question with '---'.
- Do NOT put all questions into a single table.

STUDY MATERIAL:
${processedText}`,

    flashcards: `You are an expert study assistant for StudyFlow AI.
Create 8 to 10 high-yield flashcards based on the provided study material to help students master core concepts.

Output in clean Markdown with this exact structure for each card:

# Study Flashcards

A brief 1-sentence description of the deck.

---

### Card 1
**Front:** [Clear question, concept, or term to define]
**Back:** [Concise, clear answer or explanation]

---

### Card 2
...

${FORMATTING_RULES}
- Front should be punchy and focused on one concept.
- Back should provide a clear, memorable explanation.
- Separate cards with '---'.

STUDY MATERIAL:
${processedText}`,

    revision: `You are an expert exam tutor for StudyFlow AI.
Create concise, exam-focused revision notes based on the provided study material.
Format in clean, structured Markdown using this outline:

# Revision Notes

## 📌 Must-Know Concepts
- High-yield exam points with short, clear explanations.

## 📖 Essential Definitions
- **[Term]**: Concise definition and key distinction.

## ⚡ Key Formulas & Rules
- Key formulas, theorems, syntax, or decision rules (only if relevant to the material).

## 🔍 Practical Examples
- Short, high-impact examples illustrating how core rules or concepts work.

## ⚠️ Common Confusions & Pitfalls
- Clarifications on concepts, terms, or steps that students frequently mix up.

## ✅ Last-Minute Checklist
- Fast bullet points for a quick final review before an exam.

${FORMATTING_RULES}
- Adapt sections to the source material; omit formulas if irrelevant.
- Use short, meaningful bullet points. Do not repeat the same point.

STUDY MATERIAL:
${processedText}`,

    ask: processedText
      ? `You are StudyFlow AI, a helpful, patient, and beginner-friendly study tutor.
Answer the student's question using the provided study material as primary context so your explanation is directly relevant to their notes.

GUIDELINES:
- Explain the answer in simple, beginner-friendly language with clean Markdown.
- Clearly distinguish between information drawn directly from the uploaded notes and any helpful general knowledge or context you provide.
- If the study material does not contain enough information to fully answer the question, clearly state what the notes cover and supplement with general knowledge, noting the distinction.
${FORMATTING_RULES}

STUDY MATERIAL (FROM STUDENT'S UPLOADED NOTES):
${processedText}

STUDENT'S QUESTION:
${cleanQuestion}`
      : `You are StudyFlow AI, a helpful, patient, and beginner-friendly study tutor.
The student has not uploaded any study material yet. Answer their study question using general knowledge.

GUIDELINES:
- Explain concepts in simple, clear, beginner-friendly language with clean Markdown.
- Break down difficult concepts into small steps and use practical examples.
- Clearly state that your answer is based on general knowledge since no study notes have been uploaded yet (remind them they can upload notes in My Notes for personalized explanations).
${FORMATTING_RULES}

STUDENT'S QUESTION:
${cleanQuestion}`,
  };

  return prompts[task];
}

// ============================================
// MAIN AI ENDPOINT
// ============================================

app.post("/api/ai", async (req, res) => {
  try {
    const { task, text, question, history = [], count } = req.body;

    const validTasks = ["summarize", "topics", "mcqs", "revision", "ask", "flashcards"];
    if (!task || typeof task !== "string" || !validTasks.includes(task)) {
      return res.status(400).json({
        error: "Invalid task specified.",
      });
    }

    const requestedCount = Math.min(Math.max(parseInt(count, 10) || 5, 3), 25);

    function getTaskTokenLimit(t, countVal = 5) {
      if (t === "mcqs") {
        return Math.min(750 + countVal * 140, 3600);
      }
      if (t === "flashcards") {
        return 1400;
      }
      return TASK_OUTPUT_TOKEN_LIMITS[t] || 1000;
    }

    // PDF study material validation
    if (task !== "ask") {
      if (!text || typeof text !== "string" || !text.trim()) {
        return res.status(400).json({
          error: "Please provide study material from an uploaded PDF.",
        });
      }

      if (text.length > ABSOLUTE_MAX_TEXT_CHARS) {
        return res.status(413).json({
          error:
            "This document is too large to process in one request (exceeds 100,000 characters). Try uploading a smaller chapter or section.",
        });
      }
    }

    // Tutor question validation
    if (task === "ask") {
      if (!question || typeof question !== "string" || !question.trim()) {
        return res.status(400).json({
          error: "Please enter a question.",
        });
      }
    }

    const hasStudyMaterial = typeof text === "string" && text.trim().length > 0;
    const cleanQuestion = typeof question === "string" ? question.trim() : "";
    const rawTextTrimmed = hasStudyMaterial ? text.trim() : "";

    // -------------------------------------------------------------
    // STRATEGY 1: TWO-CHUNK PROCESSING FOR MEDIUM-LARGE DOCUMENTS
    // (Between 5,500 and 12,000 chars)
    // -------------------------------------------------------------
    if (
      task !== "ask" &&
      rawTextTrimmed.length > SINGLE_CHUNK_MAX_CHARS &&
      rawTextTrimmed.length <= TWO_CHUNK_MAX_CHARS
    ) {
      console.log(
        `Processing document in 2 sequential chunks (${rawTextTrimmed.length} characters)...`
      );

      const midpoint = Math.floor(rawTextTrimmed.length / 2);
      const chunk1 = rawTextTrimmed.slice(0, midpoint);
      const chunk2 = rawTextTrimmed.slice(midpoint);

      const count1 = Math.ceil(requestedCount / 2);
      const count2 = requestedCount - count1;

      const chunkPrompts = {
        summarize: [
          `Generate Part 1 of the Study Summary covering foundational overview and key concepts from this first section of notes:\n\n${chunk1}`,
          `Generate Part 2 of the Study Summary covering advanced concepts, important definitions, formulas, and key takeaways from this second section of notes:\n\n${chunk2}`,
        ],
        topics: [
          `Analyze and identify main topics and conceptual difficulty from Part 1 of the material. Output individual topic sections (no giant tables):\n\n${chunk1}`,
          `Analyze and identify main topics and conceptual difficulty from Part 2 of the material. Output individual topic sections (no giant tables):\n\n${chunk2}`,
        ],
        mcqs: [
          `Generate exactly ${count1} practice multiple choice questions numbered Question 1 to Question ${count1} based on Part 1 of this material. Include four options (A, B, C, D), correct answer, and explanation:\n\n${chunk1}`,
          `Generate exactly ${count2} practice multiple choice questions numbered Question ${count1 + 1} to Question ${requestedCount} based on Part 2 of this material. Include four options (A, B, C, D), correct answer, and explanation:\n\n${chunk2}`,
        ],
        revision: [
          `Create exam revision notes (must-know concepts and definitions) from Part 1 of this material:\n\n${chunk1}`,
          `Create exam revision notes (formulas, rules, examples, and checklist) from Part 2 of this material:\n\n${chunk2}`,
        ],
        flashcards: [
          `Create 5 high-yield flashcards (numbered Card 1 to Card 5 with **Front:** and **Back:**) from Part 1:\n\n${chunk1}`,
          `Create 5 high-yield flashcards (numbered Card 6 to Card 10 with **Front:** and **Back:**) from Part 2:\n\n${chunk2}`,
        ],
      };

      const taskPrompts = chunkPrompts[task];
      if (taskPrompts) {
        const chunkTokenLimit = Math.min(
          Math.ceil(getTaskTokenLimit(task, requestedCount) / 1.5),
          2000
        );

        // Run chunk 1
        const completion1 = await callGroqWithRetry({
          model: GROQ_MODEL,
          messages: [
            {
              role: "system",
              content: `You are StudyFlow AI study companion. ${FORMATTING_RULES}`,
            },
            { role: "user", content: taskPrompts[0] },
          ],
          max_completion_tokens: chunkTokenLimit,
        });

        const result1 = cleanAIOutput(completion1.choices?.[0]?.message?.content || "");

        // Brief wait between chunks to pace TPM usage
        await new Promise((r) => setTimeout(r, 1200));

        // Run chunk 2
        const completion2 = await callGroqWithRetry({
          model: GROQ_MODEL,
          messages: [
            {
              role: "system",
              content: `You are StudyFlow AI study companion. ${FORMATTING_RULES}`,
            },
            { role: "user", content: taskPrompts[1] },
          ],
          max_completion_tokens: chunkTokenLimit,
        });

        const result2 = cleanAIOutput(completion2.choices?.[0]?.message?.content || "");

        const combinedResult = `> 📄 **Document Coverage**: Processed in 2 comprehensive sections covering all ${rawTextTrimmed.length.toLocaleString()} characters of your notes.\n\n${result1}\n\n---\n\n${result2}`;

        return res.json({
          result: combinedResult.trim(),
        });
      }
    }

    // -------------------------------------------------------------
    // STRATEGY 2: SINGLE-REQUEST OR REPRESENTATIVELY SAMPLED MATERIAL
    // -------------------------------------------------------------
    const { text: processedText, isSampled } = hasStudyMaterial
      ? prepareSampledMaterial(rawTextTrimmed)
      : { text: "", isSampled: false };

    // Format messages for Groq
    let messages = [];

    if (task === "ask") {
      // For tutor, include trimmed conversation history (max 4 messages, 250 chars each)
      const validHistory = Array.isArray(history)
        ? history
            .filter(
              (m) =>
                m &&
                ["user", "assistant"].includes(m.role) &&
                typeof (m.text || m.content) === "string" &&
                (m.text || m.content).trim()
            )
            .slice(-4)
            .map((m) => ({
              role: m.role,
              content: (m.text || m.content).trim().slice(0, 250),
            }))
        : [];

      messages = [
        {
          role: "system",
          content: `You are StudyFlow AI, a helpful, patient study tutor. ${FORMATTING_RULES}`,
        },
        ...validHistory,
        {
          role: "user",
          content: getPrompt("ask", processedText, cleanQuestion, requestedCount),
        },
      ];
    } else {
      messages = [
        {
          role: "user",
          content: getPrompt(task, processedText, cleanQuestion, requestedCount),
        },
      ];
    }

    const completion = await callGroqWithRetry({
      model: GROQ_MODEL,
      messages,
      max_completion_tokens: getTaskTokenLimit(task, requestedCount),
    });

    let rawResult = completion.choices?.[0]?.message?.content;

    if (typeof rawResult !== "string" || !rawResult.trim()) {
      return res.status(502).json({
        error: "The AI did not generate a response. Please try again.",
      });
    }

    let finalResult = cleanAIOutput(rawResult);

    // If text was sampled due to very large document size (>12k chars), prepend helpful scope banner
    if (isSampled && task !== "ask") {
      finalResult = `> ℹ️ **Document Coverage Note**: Your uploaded document is extensive (${rawTextTrimmed.length.toLocaleString()} characters). To strictly respect AI rate limits (8,000 tokens per minute), key sections from the beginning, core body, and concluding takeaways were extracted and synthesized.\n\n${finalResult}`;
    }

    return res.json({
      result: finalResult.trim(),
    });
  } catch (error) {
    console.error("Groq API error:", error?.status || "", error?.message || error);

    const status = error?.status;
    const rawMessage = (error?.message || error?.error?.message || "").toLowerCase();

    let statusCode =
      typeof status === "number" && status >= 400 && status < 600 ? status : 500;
    let userMessage = "Unable to complete the AI request. Please try again in a moment.";

    if (
      statusCode === 413 ||
      statusCode === 429 ||
      rawMessage.includes("413") ||
      rawMessage.includes("429") ||
      rawMessage.includes("rate limit") ||
      rawMessage.includes("tokens per minute") ||
      rawMessage.includes("tpm") ||
      rawMessage.includes("too large")
    ) {
      statusCode = 429;
      userMessage =
        "The AI service is temporarily busy due to Groq rate limits (8,000 tokens per minute). Please wait about 30 seconds before submitting another request.";
    } else if (
      statusCode === 401 ||
      rawMessage.includes("api key") ||
      rawMessage.includes("authentication")
    ) {
      statusCode = 500;
      userMessage =
        "AI service authentication error. Please verify your GROQ_API_KEY in the backend configuration.";
    } else if (
      statusCode === 503 ||
      statusCode === 502 ||
      rawMessage.includes("overloaded") ||
      rawMessage.includes("unavailable")
    ) {
      statusCode = 503;
      userMessage =
        "The AI service is temporarily overloaded. Please wait a moment and try again.";
    }

    return res.status(statusCode).json({
      error: userMessage,
    });
  }
});

// ============================================
// STANDALONE AI TUTOR ENDPOINT
// ============================================

app.post("/api/tutor", async (req, res) => {
  try {
    const { question, history = [], documentText = "" } = req.body;

    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({
        error: "Please enter a question.",
      });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({
        error: "Conversation history must be an array.",
      });
    }

    // Keep only last 4 messages, trimmed to 250 characters each
    const validHistory = history
      .filter(
        (message) =>
          message &&
          ["user", "assistant"].includes(message.role) &&
          typeof (message.text || message.content) === "string" &&
          (message.text || message.content).trim()
      )
      .slice(-4)
      .map((message) => ({
        role: message.role,
        content: (message.text || message.content).trim().slice(0, 250),
      }));

    const cleanQuestion = question.trim();
    const hasNotes = typeof documentText === "string" && documentText.trim().length > 0;
    const safeNotes = hasNotes ? documentText.trim().slice(0, 3500) : "";

    const userContent = hasNotes
      ? `STUDY MATERIAL (FROM STUDENT'S UPLOADED NOTES):\n${safeNotes}\n\nSTUDENT'S QUESTION:\n${cleanQuestion}`
      : cleanQuestion;

    const messages = [
      {
        role: "system",
        content: `You are StudyFlow AI, a friendly, patient study tutor.
${hasNotes ? "The student provided study notes. Ground your answers in their notes, but supplement with general knowledge when needed and note the distinction." : "The student has no notes uploaded. Provide clear general study explanations."}
${FORMATTING_RULES}`,
      },
      ...validHistory,
      {
        role: "user",
        content: userContent,
      },
    ];

    const completion = await callGroqWithRetry({
      model: GROQ_MODEL,
      messages,
      max_completion_tokens: TASK_OUTPUT_TOKEN_LIMITS.ask,
    });

    const answer = completion.choices?.[0]?.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(502).json({
        error: "The AI did not generate an answer. Please try again.",
      });
    }

    return res.json({
      answer: cleanAIOutput(answer).trim(),
      source: hasNotes ? "notes" : "general",
    });
  } catch (error) {
    console.error("AI Tutor error:", error?.status || "", error?.message || error);
    const msg = (error?.message || "").toLowerCase();

    if (error?.status === 429 || error?.status === 413 || msg.includes("tpm") || msg.includes("rate limit")) {
      return res.status(429).json({
        error:
          "The AI tutor is temporarily busy due to rate limits. Please wait about 30 seconds and ask again.",
      });
    }

    return res.status(500).json({
      error: "Unable to get an AI tutor response. Please try again.",
    });
  }
});

// ============================================
// MOCK TEST GENERATION & EVALUATION ENDPOINTS
// ============================================

/**
 * Safely extracts and repairs JSON from raw LLM output, handling markdown fences,
 * leading/trailing commentary, unescaped LaTeX backslashes, literal newlines inside strings,
 * trailing commas, and partial JSON truncation recovery.
 */
function extractJSONFromText(text) {
  if (!text || typeof text !== "string") return null;
  let cleaned = text.trim();

  // Strip markdown code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Find outer boundaries { ... } or [ ... ]
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  let candidate = cleaned;
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidate = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // 1. Direct parse attempt
  try {
    return JSON.parse(candidate);
  } catch (e1) {}

  // 2. Character-by-character scanner for repairing invalid backslashes & control chars inside strings
  let inString = false;
  let escaped = false;
  let repaired = "";

  for (let i = 0; i < candidate.length; i++) {
    const char = candidate[i];
    if (!inString) {
      if (char === '"') inString = true;
      repaired += char;
    } else {
      if (escaped) {
        if (['"', "\\", "/", "b", "f", "n", "r", "t"].includes(char)) {
          repaired += char;
        } else if (char === "u" && /^[0-9a-fA-F]{4}/.test(candidate.slice(i + 1, i + 5))) {
          repaired += char;
        } else {
          // Unescaped / invalid backslash sequence (e.g. LaTeX \(, \dots, \log, \Theta, \le, \approx).
          // Escape the backslash so valid JSON is formed!
          repaired += "\\" + char;
        }
        escaped = false;
      } else if (char === "\\") {
        repaired += "\\";
        escaped = true;
      } else if (char === '"') {
        inString = false;
        repaired += char;
      } else if (char === "\n") {
        repaired += "\\n";
      } else if (char === "\r") {
        repaired += "\\r";
      } else if (char === "\t") {
        repaired += "\\t";
      } else {
        repaired += char;
      }
    }
  }

  // Remove trailing commas before closing braces or brackets
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(repaired);
  } catch (e2) {}

  // 3. Try bracket-enclosed array if candidate was an array
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      let arrText = cleaned.slice(firstBracket, lastBracket + 1);
      arrText = arrText.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(arrText);
    } catch (e3) {}
  }

  // 4. Truncated JSON recovery for questions array
  const qIdx = repaired.indexOf('"questions"');
  if (qIdx !== -1) {
    const bIdx = repaired.indexOf("[", qIdx);
    if (bIdx !== -1) {
      let p = repaired.lastIndexOf("}");
      while (p > bIdx) {
        const truncatedCandidate = repaired.slice(0, p + 1) + "]}";
        try {
          const parsed = JSON.parse(truncatedCandidate);
          if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
            return parsed;
          }
        } catch (e4) {}
        p = repaired.lastIndexOf("}", p - 1);
      }
    }
  }

  return null;
}

/**
 * Normalizes question object into standard StudyFlow AI schema
 */
function normalizeQuestion(q, defaultType, defaultMarks, assignedIndex) {
  let qType = defaultType;
  if (typeof q.type === "string") {
    const rawType = q.type.toLowerCase().trim();
    if (rawType.includes("mcq") || rawType.includes("choice") || rawType.includes("objective")) {
      qType = "mcq";
    } else if (rawType.includes("short") || rawType.includes("brief")) {
      qType = "short";
    } else if (rawType.includes("long") || rawType.includes("essay") || rawType.includes("detailed")) {
      qType = "long";
    }
  }

  const questionText = (q.question || q.prompt || q.questionText || `Question ${assignedIndex}`).trim();
  const marks = typeof q.marks === "number" && q.marks > 0 ? q.marks : defaultMarks;

  let options = undefined;
  let correctOption = undefined;

  if (qType === "mcq") {
    let rawOptions = q.options || q.choices;
    if (rawOptions && !Array.isArray(rawOptions) && typeof rawOptions === "object") {
      rawOptions = Object.entries(rawOptions).map(([label, text]) => ({ label, text }));
    }

    if (Array.isArray(rawOptions) && rawOptions.length >= 2) {
      options = rawOptions.slice(0, 4).map((opt, i) => {
        const defaultLabel = ["A", "B", "C", "D"][i] || "A";
        if (typeof opt === "string") {
          const match = opt.match(/^([A-D])[).:]\s*(.+)$/i);
          if (match) {
            return { label: match[1].toUpperCase(), text: match[2].trim() };
          }
          return { label: defaultLabel, text: opt.trim() };
        } else if (opt && typeof opt === "object") {
          const label = String(opt.label || opt.key || defaultLabel).toUpperCase().trim();
          const text = String(opt.text || opt.value || opt.content || "").trim();
          return { label: label.length === 1 ? label : defaultLabel, text };
        }
        return { label: defaultLabel, text: String(opt) };
      });
    }

    if (!options || options.length < 2) {
      options = [
        { label: "A", text: "True / Valid implementation" },
        { label: "B", text: "False / Invalid implementation" },
        { label: "C", text: "Inconclusive without preconditions" },
        { label: "D", text: "Requires exponential search space" },
      ];
    }

    correctOption = "A";
    if (q.correctOption || q.correctAnswer || q.answer) {
      const rawAns = String(q.correctOption || q.correctAnswer || q.answer).trim();
      const match = rawAns.match(/\b([A-D])\b/i);
      if (match) {
        correctOption = match[1].toUpperCase();
      } else {
        const found = options.find((o) => o.text.toLowerCase() === rawAns.toLowerCase());
        if (found) {
          correctOption = found.label;
        }
      }
    }
  }

  const explanation = (q.explanation || q.rationale || "No explanation provided.").trim();
  const referenceAnswer = (
    q.referenceAnswer ||
    q.modelAnswer ||
    q.sampleAnswer ||
    (qType === "mcq" ? `Option (${correctOption}): ${explanation}` : "See curriculum model answer.")
  ).trim();

  const rubric = (
    q.rubric ||
    q.gradingCriteria ||
    (qType === "mcq"
      ? `Award ${marks} marks for option ${correctOption}. 0 marks otherwise.`
      : `Award up to ${marks} marks based on factual accuracy, methodology, and depth.`)
  ).trim();

  return {
    id: `q-${assignedIndex}`,
    type: qType,
    question: questionText,
    marks,
    options,
    correctOption: qType === "mcq" ? correctOption : undefined,
    explanation,
    referenceAnswer,
    rubric,
  };
}

app.post("/api/mock-test/generate", async (req, res) => {
  try {
    const {
      sourceType = "topic",
      sourceName = "General Topic",
      sourceText = "",
      topic = "",
      difficulty = "Medium",
      durationMinutes = 30,
      questionCount = 10,
      format = "mixed",
      distribution = null,
      customMarks = null,
    } = req.body;

    const totalQuestions = Math.min(Math.max(parseInt(questionCount, 10) || 10, 5), 20);
    const duration = Math.min(Math.max(parseInt(durationMinutes, 10) || 30, 15), 60);

    // Validate source sufficiency
    const rawTextTrimmed = typeof sourceText === "string" ? sourceText.trim() : "";
    const cleanTopic = typeof topic === "string" ? topic.trim() : "";

    if (sourceType !== "topic") {
      if (!rawTextTrimmed || rawTextTrimmed.length < 80) {
        return res.status(400).json({
          error:
            "The selected source material has insufficient text to generate a grounded test. Please select a fuller study note or choose the 'Custom Topic' option.",
        });
      }

      if (rawTextTrimmed.length < 350 && totalQuestions > 5) {
        return res.status(400).json({
          error: `The selected material contains limited text (~${Math.round(
            rawTextTrimmed.length / 6
          )} words), which is insufficient to generate ${totalQuestions} distinct grounded questions. Please choose 5 questions or provide a fuller source document.`,
        });
      }
    } else {
      if (!cleanTopic && !rawTextTrimmed) {
        return res.status(400).json({
          error: "Please enter a subject topic or paste reference material for your mock test.",
        });
      }
    }

    // Determine question distribution
    let mcqCount = 0;
    let shortCount = 0;
    let longCount = 0;

    if (format === "mcq") {
      mcqCount = totalQuestions;
    } else if (format === "short") {
      shortCount = totalQuestions;
    } else if (format === "long") {
      longCount = totalQuestions;
    } else {
      // Mixed format: preserve requested counts
      if (
        distribution &&
        typeof distribution.mcq === "number" &&
        typeof distribution.short === "number" &&
        typeof distribution.long === "number"
      ) {
        mcqCount = Math.max(0, parseInt(distribution.mcq, 10) || 0);
        shortCount = Math.max(0, parseInt(distribution.short, 10) || 0);
        longCount = Math.max(0, parseInt(distribution.long, 10) || 0);

        const currentSum = mcqCount + shortCount + longCount;
        if (currentSum !== totalQuestions && currentSum > 0) {
          mcqCount = Math.round((mcqCount / currentSum) * totalQuestions);
          shortCount = Math.round((shortCount / currentSum) * totalQuestions);
          longCount = totalQuestions - mcqCount - shortCount;
          if (longCount < 0) {
            mcqCount += longCount;
            longCount = 0;
          }
        }
      } else {
        // Sensible default distribution
        if (totalQuestions === 5) {
          mcqCount = 3;
          shortCount = 1;
          longCount = 1;
        } else if (totalQuestions === 10) {
          mcqCount = 5;
          shortCount = 3;
          longCount = 2;
        } else if (totalQuestions === 15) {
          mcqCount = 8;
          shortCount = 5;
          longCount = 2;
        } else {
          mcqCount = 10;
          shortCount = 6;
          longCount = 4;
        }
      }
    }

    // Marks allocation
    const mcqMark = customMarks?.mcq ? Math.max(1, parseInt(customMarks.mcq, 10) || 2) : 2;
    const shortMark = customMarks?.short ? Math.max(1, parseInt(customMarks.short, 10) || 4) : 4;
    const longMark = customMarks?.long ? Math.max(1, parseInt(customMarks.long, 10) || 8) : 8;

    // Grounding context
    let contextDescription = "";
    if (sourceType === "topic") {
      contextDescription = `TOPIC: "${cleanTopic || sourceName}"`;
      if (rawTextTrimmed) {
        contextDescription += `\n\nREFERENCE NOTES:\n${rawTextTrimmed.slice(0, 8000)}`;
      }
    } else {
      contextDescription = `SOURCE DOCUMENT: "${sourceName}"\n\nSTUDY MATERIAL:\n${rawTextTrimmed.slice(0, 8000)}`;
    }

    // Chunk sections into token-safe sub-batches
    // Long answers are lengthy and detailed, so max 2 per prompt
    // Short answers: max 5 per prompt
    // MCQs: max 8 per prompt
    const MAX_BATCH = { mcq: 8, short: 5, long: 2 };

    const sectionsToGenerate = [];
    function addSection(type, totalCount, mark) {
      const maxB = MAX_BATCH[type] || 5;
      let remaining = totalCount;
      while (remaining > 0) {
        const batchCount = Math.min(remaining, maxB);
        sectionsToGenerate.push({ type, count: batchCount, mark });
        remaining -= batchCount;
      }
    }

    if (mcqCount > 0) addSection("mcq", mcqCount, mcqMark);
    if (shortCount > 0) addSection("short", shortCount, shortMark);
    if (longCount > 0) addSection("long", longCount, longMark);

    // Helper to generate a batch of questions of a specific type
    async function generateQuestionsBatch(sectionType, count, mark, retry = 0) {
      let prompt = "";
      let tokenBudget = 3600;

      if (sectionType === "mcq") {
        tokenBudget = Math.min(2000 + count * 280, 4200);
        prompt = `You are an expert academic exam creator for StudyFlow AI.
Generate exactly ${count} Multiple Choice Questions (MCQ) on the study context below.
Difficulty: ${difficulty}
Marks per question: ${mark}

RULES:
1. Generate EXACTLY ${count} high-quality, rigorous MCQ questions.
2. Each question MUST include 4 distinct, plausible options labeled A, B, C, D.
3. Specify "correctOption" as "A", "B", "C", or "D".
4. Provide a clear pedagogical explanation explaining why the correct option is right and others are incorrect.
5. Base questions strictly on the study context.
6. Output ONLY valid JSON matching this schema:
{
  "testTitle": "Concise Descriptive Title for this Examination",
  "questions": [
    {
      "type": "mcq",
      "question": "Clear question text...",
      "options": [
        { "label": "A", "text": "Option A text" },
        { "label": "B", "text": "Option B text" },
        { "label": "C", "text": "Option C text" },
        { "label": "D", "text": "Option D text" }
      ],
      "correctOption": "B",
      "explanation": "Detailed explanation of why B is correct...",
      "marks": ${mark}
    }
  ]
}

CONTEXT MATERIAL:
${contextDescription}`;
      } else if (sectionType === "short") {
        tokenBudget = Math.min(2000 + count * 350, 4200);
        prompt = `You are an expert academic exam creator for StudyFlow AI.
Generate exactly ${count} Short Answer Questions on the study context below.
Difficulty: ${difficulty}
Marks per question: ${mark}

RULES:
1. Generate EXACTLY ${count} conceptual Short Answer questions requiring 2-4 sentences of focused analysis, calculation, or explanation.
2. Provide a concise reference model answer demonstrating conceptual mastery.
3. Provide a clear 2-3 point grading rubric totaling ${mark} marks.
4. Base questions strictly on the study context.
5. Output ONLY valid JSON matching this schema:
{
  "testTitle": "Concise Descriptive Title for this Examination",
  "questions": [
    {
      "type": "short",
      "question": "Clear question text...",
      "referenceAnswer": "Concise model answer (2-4 sentences)...",
      "rubric": "Grading criteria: 1) Core definition (${Math.round(mark / 2)} marks), 2) Mechanism/application (${mark - Math.round(mark / 2)} marks).",
      "marks": ${mark}
    }
  ]
}

CONTEXT MATERIAL:
${contextDescription}`;
      } else {
        tokenBudget = Math.min(2400 + count * 700, 4500);
        prompt = `You are an expert academic exam creator for StudyFlow AI.
Generate exactly ${count} Long Answer Questions on the study context below.
Difficulty: ${difficulty}
Marks per question: ${mark}

RULES:
1. Generate EXACTLY ${count} in-depth analytical, algorithmic, or architectural Long Answer questions.
2. Provide a detailed, comprehensive reference model answer covering principles, mechanisms, proofs, and edge cases.
3. Provide a structured multi-point grading rubric totaling ${mark} marks.
4. Base questions strictly on the study context.
5. Output ONLY valid JSON matching this schema:
{
  "testTitle": "Concise Descriptive Title for this Examination",
  "questions": [
    {
      "type": "long",
      "question": "Comprehensive question text requiring structured response...",
      "referenceAnswer": "Detailed model answer covering all core aspects...",
      "rubric": "Grading criteria: 1) Theoretical foundation (${Math.round(mark * 0.3)} marks), 2) Design/mechanism (${Math.round(mark * 0.4)} marks), 3) Analysis and edge cases (${mark - Math.round(mark * 0.3) - Math.round(mark * 0.4)} marks).",
      "marks": ${mark}
    }
  ]
}

CONTEXT MATERIAL:
${contextDescription}`;
      }

      const completion = await callGroqWithRetry({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: "You are StudyFlow AI examination creator. You generate structured JSON mock examinations. Output ONLY valid JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_completion_tokens: tokenBudget,
        temperature: 0.3,
      });

      const raw = completion.choices?.[0]?.message?.content || "";
      const parsed = extractJSONFromText(raw);

      let extractedQuestions = null;
      if (Array.isArray(parsed)) {
        extractedQuestions = parsed;
      } else if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.questions)) {
          extractedQuestions = parsed.questions;
        } else {
          // Look for any array property containing question-like objects
          for (const key of Object.keys(parsed)) {
            if (
              Array.isArray(parsed[key]) &&
              parsed[key].length > 0 &&
              (parsed[key][0].question || parsed[key][0].prompt || parsed[key][0].type)
            ) {
              extractedQuestions = parsed[key];
              break;
            }
          }
        }
      }

      if (!extractedQuestions || extractedQuestions.length === 0) {
        console.warn(`Section ${sectionType} parse issue (attempt ${retry + 1}/3). Raw snippet:`, raw.slice(0, 200));
        if (retry < 2) {
          console.warn(`Retrying section ${sectionType} (attempt ${retry + 2}/3)...`);
          return await generateQuestionsBatch(sectionType, count, mark, retry + 1);
        }
        throw new Error(`AI was unable to generate valid questions for section ${sectionType}.`);
      }

      return {
        testTitle: (parsed && typeof parsed === "object" && parsed.testTitle) || "",
        questions: extractedQuestions,
      };
    }

    let overallTitle = `${cleanTopic || sourceName} Mock Examination`;
    let rawGeneratedQuestions = [];

    // Execute generation section by section to preserve exact counts and token safety
    for (const section of sectionsToGenerate) {
      const batchResult = await generateQuestionsBatch(section.type, section.count, section.mark);
      if (batchResult.testTitle && overallTitle.includes("Mock Examination")) {
        overallTitle = batchResult.testTitle;
      }

      let sectionQuestions = batchResult.questions;

      // If fewer questions were returned in this section, attempt targeted top-up
      if (sectionQuestions.length < section.count) {
        const missingCount = section.count - sectionQuestions.length;
        try {
          const topUp = await generateQuestionsBatch(section.type, missingCount, section.mark, 1);
          if (topUp && Array.isArray(topUp.questions)) {
            sectionQuestions = sectionQuestions.concat(topUp.questions);
          }
        } catch (eTopUp) {
          console.warn(`Section ${section.type} top-up skipped:`, eTopUp.message);
        }
      }

      // Clamp to exact requested count
      if (sectionQuestions.length > section.count) {
        sectionQuestions = sectionQuestions.slice(0, section.count);
      }

      // Tag each question with its target section type and marks
      sectionQuestions.forEach((q) => {
        rawGeneratedQuestions.push({
          ...q,
          targetType: section.type,
          targetMark: section.mark,
        });
      });
    }

    if (rawGeneratedQuestions.length === 0) {
      return res.status(502).json({
        error: "The AI was unable to generate a properly structured test. Please try again or choose a smaller question count.",
      });
    }

    // Process and validate questions in order
    let assignedIndex = 1;
    const validatedQuestions = rawGeneratedQuestions.map((q) => {
      return normalizeQuestion(q, q.targetType, q.targetMark, assignedIndex++);
    });

    const totalCalculatedMarks = validatedQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);

    return res.json({
      success: true,
      testTitle: overallTitle,
      questions: validatedQuestions,
      totalMarks: totalCalculatedMarks,
      durationMinutes: duration,
      difficulty,
      format,
      distribution: {
        mcq: validatedQuestions.filter((q) => q.type === "mcq").length,
        short: validatedQuestions.filter((q) => q.type === "short").length,
        long: validatedQuestions.filter((q) => q.type === "long").length,
      },
    });
  } catch (error) {
    console.error("Mock test generation error:", error?.status || "", error?.message || error);
    const msg = (error?.message || "").toLowerCase();

    if (error?.status === 429 || error?.status === 413 || msg.includes("tpm") || msg.includes("rate limit")) {
      return res.status(429).json({
        error:
          "The AI service is temporarily busy due to rate limits. Please wait about 30 seconds and try generating your test again.",
      });
    }

    return res.status(500).json({
      error: error.message || "Unable to generate mock examination. Please verify your source material and try again.",
    });
  }
});

app.post("/api/mock-test/evaluate", async (req, res) => {
  try {
    const { testId, writtenAnswers = [] } = req.body;

    if (!Array.isArray(writtenAnswers) || writtenAnswers.length === 0) {
      // No written answers to evaluate (e.g. MCQ only)
      return res.json({
        success: true,
        evaluations: {},
      });
    }

    // Build structured grading evaluation prompt
    const questionsBlock = writtenAnswers
      .map((item, idx) => {
        return `---
ITEM ${idx + 1}:
Question ID: ${item.questionId}
Type: ${item.questionType}
Max Marks: ${item.maxMarks}
Question: ${item.questionText}
Model Reference Answer: ${item.referenceAnswer || "N/A"}
Marking Rubric: ${item.rubric || "Evaluate accuracy and completeness."}
Student's Submitted Response:
"""
${item.studentAnswer && item.studentAnswer.trim() ? item.studentAnswer.trim() : "[Student left this question blank]"}
"""`;
      })
      .join("\n\n");

    const evaluationPrompt = `You are a fair, expert academic examiner.
Evaluate each student's written response against the question, reference answer, and marking rubric.

GRADING PRINCIPLES:
1. Conceptual Correctness: Award marks based on conceptual understanding and relevant key points, not length or rote phrasing.
2. Accept Different Phrasing: Do NOT penalize students for harmless wording differences, synonyms, or alternative valid approaches. If the core concept is understood, award full credit for that point.
3. No Mere Fluency Credit: Do not award full marks merely because the response sounds fluent or confident if key concepts are omitted or incorrect.
4. Partial Marks: Award partial marks when justified (e.g. 2.5 / 4 if half the key concepts are present and accurate).
5. Identify Gaps: Clearly list specific missing concepts and any mistakes or misconceptions.
6. Bounds: marksAwarded MUST be a number between 0 and maxMarks (inclusive). Never award negative marks or exceed maxMarks.
7. Blank Responses: If student response is blank or says "I don't know", award 0 marks.

OUTPUT FORMAT:
Return ONLY a valid, parseable JSON object matching this schema. Do not include markdown code fences or conversational text outside the JSON.

{
  "evaluations": {
    "${writtenAnswers[0].questionId}": {
      "marksAwarded": 3,
      "maxMarks": ${writtenAnswers[0].maxMarks},
      "strengths": ["Demonstrates clear grasp of core definition", "Includes relevant example"],
      "missingConcepts": ["Did not mention the prerequisite constraint"],
      "mistakes": ["Confused terminology in the second sentence"],
      "feedback": "Solid conceptual effort. Focus on addressing the underlying constraint for full marks."
    }
  }
}

QUESTIONS TO EVALUATE:
${questionsBlock}`;

    const completion = await callGroqWithRetry({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are StudyFlow AI academic evaluation engine. You evaluate written answers with pedagogical rigor. Output ONLY valid JSON.",
        },
        {
          role: "user",
          content: evaluationPrompt,
        },
      ],
      max_completion_tokens: Math.min(1500 + writtenAnswers.length * 380, 4200),
      temperature: 0.1,
    });

    const rawContent = completion.choices?.[0]?.message?.content || "";
    const parsedData = extractJSONFromText(rawContent);

    if (!parsedData || typeof parsedData.evaluations !== "object") {
      console.error("Failed to parse evaluation JSON. Raw content:", rawContent.slice(0, 400));
      return res.status(502).json({
        error:
          "The AI evaluation response was incomplete. Your submitted answers are safely preserved and you can retry evaluation.",
      });
    }

    // Validate and clamp all marksAwarded
    const validatedEvaluations = {};
    writtenAnswers.forEach((item) => {
      const qId = item.questionId;
      const evalData = parsedData.evaluations[qId] || {};

      let marks = typeof evalData.marksAwarded === "number" ? evalData.marksAwarded : parseFloat(evalData.marksAwarded) || 0;
      // Clamp between 0 and maxMarks
      marks = Math.min(Math.max(0, marks), item.maxMarks);
      // Round to 1 decimal place if fractional
      marks = Math.round(marks * 10) / 10;

      validatedEvaluations[qId] = {
        marksAwarded: marks,
        maxMarks: item.maxMarks,
        strengths: Array.isArray(evalData.strengths) ? evalData.strengths : [],
        missingConcepts: Array.isArray(evalData.missingConcepts) ? evalData.missingConcepts : [],
        mistakes: Array.isArray(evalData.mistakes) ? evalData.mistakes : [],
        feedback:
          typeof evalData.feedback === "string" && evalData.feedback.trim()
            ? evalData.feedback.trim()
            : "Response assessed against conceptual rubric.",
      };
    });

    return res.json({
      success: true,
      evaluations: validatedEvaluations,
    });
  } catch (error) {
    console.error("Mock test evaluation error:", error?.status || "", error?.message || error);
    const msg = (error?.message || "").toLowerCase();

    if (error?.status === 429 || error?.status === 413 || msg.includes("tpm") || msg.includes("rate limit")) {
      return res.status(429).json({
        error:
          "The evaluation service is temporarily busy due to Groq rate limits. Your answers are safely preserved; please click 'Retry Evaluation' in 20 seconds.",
      });
    }

    return res.status(500).json({
      error:
        "Unable to complete AI evaluation at this moment. Your answers are saved; please retry evaluation.",
    });
  }
});

// ============================================
// PERSONALIZED STUDY PLANNER ENDPOINT
// ============================================

/**
 * Algorithmic curriculum fallback in case LLM is rate-limited or fails.
 * Produces realistic, mathematically partitioned daily tasks respecting daily study time.
 */
function generateFallbackStudyPlan({
  subject,
  topics,
  dailyMinutes,
  durationDays,
  targetExamDate,
  assessmentHistory,
  notesAvailable = [],
}) {
  const cleanSubject = subject || "Study";
  const userTopics = Array.isArray(topics) && topics.length > 0
    ? topics
    : ["Core Concepts", "Foundational Principles", "Problem Solving", "Comprehensive Review"];

  const weakTopics = Array.isArray(assessmentHistory?.weakTopics)
    ? assessmentHistory.weakTopics
    : [];

  // Prioritize weak topics first if assessment history exists
  const prioritizedTopics = [
    ...weakTopics.filter((t) => userTopics.some((ut) => ut.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(ut.toLowerCase()))),
    ...userTopics,
  ];
  // Deduplicate
  const uniqueTopics = [...new Set(prioritizedTopics)];

  const planTitle = `${durationDays}-Day ${cleanSubject} Study Plan`;
  const startDate = new Date();
  const days = [];

  let topicIndex = 0;
  for (let d = 1; d <= durationDays; d++) {
    const scheduledDate = new Date(startDate.getTime() + (d - 1) * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const currentTopic = uniqueTopics[topicIndex % uniqueTopics.length];
    const isWeakTopic = weakTopics.includes(currentTopic);
    const isReviewDay = d % 4 === 0 || d === durationDays;
    const isAssessmentDay = d % 7 === 0 || d === durationDays;

    const tasks = [];
    const targetDaily = Math.max(20, dailyMinutes || 60);

    if (isAssessmentDay) {
      // Assessment + Review Day
      const mockTime = Math.min(Math.round(targetDaily * 0.6), 45);
      const reviewTime = targetDaily - mockTime;

      tasks.push({
        id: `task-${d}-1`,
        dayNumber: d,
        scheduledDate,
        title: `Comprehensive Checkpoint Assessment: ${currentTopic}`,
        topic: currentTopic,
        type: "assessment",
        estimatedMinutes: mockTime,
        priority: "High",
        description: `Complete a timed practice quiz or mock test covering ${currentTopic} to test retention.`,
        completed: false,
      });

      tasks.push({
        id: `task-${d}-2`,
        dayNumber: d,
        scheduledDate,
        title: `Evaluate Results & Clarify Gaps`,
        topic: currentTopic,
        type: "revise",
        estimatedMinutes: reviewTime,
        priority: "High",
        description: `Review any incorrect questions and record key formulas in your revision notes.`,
        completed: false,
      });
    } else if (isReviewDay) {
      // Spaced Repetition & Flashcard Day
      const part1 = Math.round(targetDaily * 0.5);
      const part2 = targetDaily - part1;

      tasks.push({
        id: `task-${d}-1`,
        dayNumber: d,
        scheduledDate,
        title: `Spaced Repetition & Flashcard Review: ${currentTopic}`,
        topic: currentTopic,
        type: "practice",
        estimatedMinutes: part1,
        priority: isWeakTopic ? "High" : "Medium",
        description: `Active recall drill on core definitions, formulas, and common pitfalls in ${currentTopic}.`,
        completed: false,
      });

      tasks.push({
        id: `task-${d}-2`,
        dayNumber: d,
        scheduledDate,
        title: `Synthesize Summary & Key Definitions`,
        topic: currentTopic,
        type: "revise",
        estimatedMinutes: part2,
        priority: "Medium",
        description: `Review your study notes and condense complex mechanisms into bullet takeaways.`,
        completed: false,
      });
    } else {
      // Standard Learn + Practice Day
      const learnTime = Math.round(targetDaily * 0.55);
      const practiceTime = targetDaily - learnTime;

      // Check if a linked note is available
      const matchingNote = notesAvailable.find(
        (n) =>
          (n.title || "").toLowerCase().includes(currentTopic.toLowerCase()) ||
          (n.text || "").toLowerCase().includes(currentTopic.toLowerCase())
      );

      tasks.push({
        id: `task-${d}-1`,
        dayNumber: d,
        scheduledDate,
        title: `Master Core Concepts: ${currentTopic}`,
        topic: currentTopic,
        type: "learn",
        estimatedMinutes: learnTime,
        priority: isWeakTopic ? "High" : "Medium",
        description: `Read foundational principles, examine step-by-step mechanisms, and take structured notes on ${currentTopic}.`,
        linkedNoteId: matchingNote ? matchingNote.id : null,
        completed: false,
      });

      tasks.push({
        id: `task-${d}-2`,
        dayNumber: d,
        scheduledDate,
        title: `Active Recall & Practical Application: ${currentTopic}`,
        topic: currentTopic,
        type: "practice",
        estimatedMinutes: practiceTime,
        priority: isWeakTopic ? "High" : "Medium",
        description: `Solve 5 to 10 practice questions and write out key steps from memory.`,
        completed: false,
      });
    }

    days.push({
      dayNumber: d,
      scheduledDate,
      tasks,
    });

    if (d % 2 === 0) {
      topicIndex++;
    }
  }

  return {
    planTitle,
    summary: `Structured ${durationDays}-day curriculum for ${cleanSubject} allocating ${dailyMinutes} minutes daily. ${
      weakTopics.length > 0
        ? `Incorporate targeted reinforcement for identified weak areas: ${weakTopics.slice(0, 3).join(", ")}.`
        : "Structured systematically from foundational concepts to advanced problem solving."
    }`,
    personalizationNotes: weakTopics.length > 0
      ? `Prioritized ${weakTopics.length} topic(s) with previous test mistakes.`
      : "Formulated balanced plan based on chosen topics.",
    days,
  };
}

app.post("/api/study-planner/generate", async (req, res) => {
  try {
    const {
      courseId = null,
      subject = "General Study",
      topics = [],
      dailyMinutes = 60,
      durationDays = 14,
      targetExamDate = null,
      goalId = null,
      assessmentHistory = null,
      notesAvailable = [],
    } = req.body;

    const daysCount = [7, 14, 30].includes(parseInt(durationDays, 10))
      ? parseInt(durationDays, 10)
      : 14;

    const minutesPerDay = Math.min(Math.max(parseInt(dailyMinutes, 10) || 60, 20), 180);

    const cleanSubject = typeof subject === "string" && subject.trim() ? subject.trim() : "General Study";

    const cleanTopics = Array.isArray(topics) && topics.length > 0
      ? topics.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim())
      : [cleanSubject];

    // Inspect real assessment history
    const hasHistory = Boolean(
      assessmentHistory &&
        ((Array.isArray(assessmentHistory.weakTopics) && assessmentHistory.weakTopics.length > 0) ||
          (Array.isArray(assessmentHistory.misconceptions) && assessmentHistory.misconceptions.length > 0) ||
          (Array.isArray(assessmentHistory.confirmedErrors) && assessmentHistory.confirmedErrors.length > 0))
    );

    let assessmentContext = "";
    if (hasHistory) {
      const weakList = (assessmentHistory.weakTopics || []).slice(0, 5).join(", ");
      const errorsList = (assessmentHistory.confirmedErrors || [])
        .slice(0, 3)
        .map((e) => `Question: "${e.question.slice(0, 70)}" -> Missed concept: ${e.feedback || e.correctAnswer}`)
        .join("\n");

      const misconcList = (assessmentHistory.misconceptions || [])
        .slice(0, 3)
        .map((m) => `Question: "${m.question.slice(0, 70)}" -> Misconception: ${(m.mistakes || []).join(", ") || m.feedback}`)
        .join("\n");

      assessmentContext = `
STUDENT'S ACTUAL ASSESSMENT DATA & DIAGNOSTICS:
- Topics where marks were lost: ${weakList}
- Confirmed Errors in past tests:
${errorsList || "None recorded"}
- Identified Misconceptions from AI written evaluation:
${misconcList || "None recorded"}

CRITICAL PERSONALIZATION INSTRUCTION:
Because the student has verified performance data, you MUST prioritize the above topics and misconceptions in the earlier days of the schedule (e.g. Days 1 to ${Math.ceil(daysCount / 2)}) with focused remediation tasks before moving to advanced topics.`;
    } else {
      assessmentContext = `
NOTE ON ASSESSMENT DATA:
The student has no previous assessment history. DO NOT invent fake learning weaknesses or claim they failed tests. Instead, design a clean, progressive curriculum starting from foundational concepts, moving through application, and finishing with comprehensive review.`;
    }

    const plannerPrompt = `You are the Lead Pedagogical Study Architect for StudyFlow AI.
Generate a realistic, highly personalized ${daysCount}-day daily study schedule for "${cleanSubject}".

PARAMETERS:
- Subject: ${cleanSubject}
- Topics to cover: ${cleanTopics.join(", ")}
- Available Daily Study Time: EXACTLY ${minutesPerDay} minutes per day.
- Duration: ${daysCount} Days.
${targetExamDate ? `- Target Exam / Milestone Date: ${targetExamDate}` : ""}

${assessmentContext}

TASK GENERATION RULES:
1. DAILY TIME LIMIT: For each day (Day 1 to Day ${daysCount}), generate 2 to 3 actionable tasks such that the sum of estimatedMinutes equals EXACTLY or very close to ${minutesPerDay} minutes (never exceed ${minutesPerDay} minutes per day).
2. TASK TYPES: Use exactly one of: "learn" (study new concepts), "revise" (review notes/definitions), "practice" (flashcards/problem solving), "assessment" (take a mock test or quiz).
3. PRIORITIES: Assign "High", "Medium", or "Low". Set "High" for topics identified from past mistakes.
4. ACTIONABLE: Each task must have a clear title, topic, description, estimatedMinutes, and priority.
5. NO HALLUCINATIONS: Base schedule strictly on the specified subject and topics.

OUTPUT FORMAT:
Respond with ONLY a valid, parseable JSON object matching this schema. No markdown fences or commentary outside the JSON:

{
  "planTitle": "${daysCount}-Day ${cleanSubject} Study Plan",
  "summary": "Brief 1-2 sentence overview explaining the schedule strategy.",
  "personalizationNotes": "Brief explanation of how assessment data or preferences shaped this plan.",
  "days": [
    {
      "dayNumber": 1,
      "tasks": [
        {
          "title": "Clear task title",
          "topic": "Topic Name",
          "type": "learn",
          "estimatedMinutes": 30,
          "priority": "High",
          "description": "Specific actionable instructions of what to read, study, or solve."
        },
        {
          "title": "Clear task title",
          "topic": "Topic Name",
          "type": "practice",
          "estimatedMinutes": 30,
          "priority": "Medium",
          "description": "Specific practice exercise or flashcard drill."
        }
      ]
    }
  ]
}`;

    const tokenBudget = Math.min(1800 + daysCount * 120, 4000);

    let parsedPlan = null;

    try {
      const completion = await callGroqWithRetry({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: "You are StudyFlow AI curriculum architect. You output ONLY valid JSON.",
          },
          {
            role: "user",
            content: plannerPrompt,
          },
        ],
        max_completion_tokens: tokenBudget,
        temperature: 0.2,
      });

      const rawContent = completion.choices?.[0]?.message?.content || "";
      parsedPlan = extractJSONFromText(rawContent);
    } catch (aiError) {
      console.warn("Groq AI planner call failed, falling back to algorithmic curriculum:", aiError?.message || aiError);
    }

    // Fallback if AI output is missing or invalid
    if (!parsedPlan || !Array.isArray(parsedPlan.days) || parsedPlan.days.length === 0) {
      parsedPlan = generateFallbackStudyPlan({
        subject: cleanSubject,
        topics: cleanTopics,
        dailyMinutes: minutesPerDay,
        durationDays: daysCount,
        targetExamDate,
        assessmentHistory,
        notesAvailable,
      });
    }

    // Process and enrich tasks with IDs, scheduled dates, and note matching
    const startDate = new Date();
    const flattenedTasks = [];

    parsedPlan.days.forEach((dayObj, dIdx) => {
      const dayNum = dayObj.dayNumber || dIdx + 1;
      const scheduledDate = new Date(startDate.getTime() + (dayNum - 1) * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      (dayObj.tasks || []).forEach((t, tIdx) => {
        const tMinutes = Math.min(Math.max(parseInt(t.estimatedMinutes, 10) || 25, 10), minutesPerDay);
        const tType = ["learn", "revise", "practice", "assessment"].includes(t.type)
          ? t.type
          : "learn";

        // Match note if available
        let linkedNoteId = t.linkedNoteId || null;
        if (!linkedNoteId && Array.isArray(notesAvailable) && notesAvailable.length > 0) {
          const matched = notesAvailable.find(
            (n) =>
              (n.title || "").toLowerCase().includes((t.topic || "").toLowerCase()) ||
              (n.title || "").toLowerCase().includes(cleanSubject.toLowerCase())
          );
          if (matched) linkedNoteId = matched.id;
        }

        flattenedTasks.push({
          id: `task-${dayNum}-${tIdx + 1}-${Math.random().toString(36).substr(2, 4)}`,
          dayNumber: dayNum,
          scheduledDate,
          title: t.title || `Study ${t.topic || cleanSubject}`,
          topic: t.topic || cleanSubject,
          type: tType,
          estimatedMinutes: tMinutes,
          priority: ["High", "Medium", "Low"].includes(t.priority) ? t.priority : "Medium",
          description: t.description || `Focus on ${t.topic || cleanSubject}.`,
          completed: false,
          completedAt: null,
          linkedNoteId,
          linkedCourseId: courseId || null,
        });
      });
    });

    return res.json({
      success: true,
      planTitle: parsedPlan.planTitle || `${daysCount}-Day ${cleanSubject} Study Plan`,
      subject: cleanSubject,
      courseId,
      topics: cleanTopics,
      dailyMinutes: minutesPerDay,
      durationDays: daysCount,
      targetExamDate,
      goalId,
      tasks: flattenedTasks,
      summary: parsedPlan.summary || `A ${daysCount}-day schedule targeting ${cleanSubject}.`,
      personalizationContext: {
        hasHistory,
        weakTopicsCount: hasHistory ? (assessmentHistory?.weakTopics || []).length : 0,
        personalizationNotes: parsedPlan.personalizationNotes || "Plan generated based on student preferences.",
      },
    });
  } catch (error) {
    console.error("Study planner generation error:", error);
    return res.status(500).json({
      error: "Unable to generate personalized study plan. Please try again.",
    });
  }
});

// ============================================
// START BACKEND SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`StudyFlow AI backend running at http://localhost:${PORT}`);
});
