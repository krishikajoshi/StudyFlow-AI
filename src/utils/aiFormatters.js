/**
 * Utility functions for cleaning, formatting, and parsing AI-generated content.
 */

/**
 * Preprocesses raw markdown text from the AI to fix all formatting artifacts:
 * - Strips outer markdown code block wrappers (```markdown ... ```).
 * - Converts raw HTML `<br>`, `<br/>`, `</br>`, `<p>`, `</p>` into real markdown newlines.
 * - Strips unwanted inline HTML tags.
 * - Fixes unspaced headings (e.g. `##Overview` -> `## Overview`).
 * - Ensures empty lines before headings, lists, tables, and dividers so CommonMark/GFM always parses them.
 * - Ensures MCQ options (A., B., C., D.) and callout labels start on new lines.
 * - Normalizes escaped newlines (\r\n and literal \n).
 */
export function cleanMarkdown(text) {
  if (!text || typeof text !== "string") return "";

  let cleaned = text;

  // 1. Normalize escaped newlines
  cleaned = cleaned.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");

  // 2. Strip outer markdown code blocks if the AI wrapped its entire answer
  const trimmed = cleaned.trim();
  const outerFence = trimmed.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  if (outerFence) {
    cleaned = outerFence[1].trim();
  }

  // 3. Strip dangerous HTML tags
  cleaned = cleaned.replace(/<\/?(?:script|iframe|object|embed|style)\b[^>]*>/gi, "");

  // 4. Convert HTML line breaks and paragraphs into markdown newlines
  cleaned = cleaned.replace(/<\/?br\s*\/?>/gi, "\n\n");
  cleaned = cleaned.replace(/<p\b[^>]*>/gi, "\n\n").replace(/<\/p>/gi, "\n\n");
  cleaned = cleaned.replace(/&nbsp;/gi, " ");

  // 5. Strip common leftover model-generated HTML container tags
  cleaned = cleaned.replace(/<\/?(?:span|div|font|mark)\b[^>]*>/gi, "");

  // 6. Fix unspaced headings (e.g., "##Overview" -> "## Overview")
  cleaned = cleaned.replace(/^(#{1,6})([^\s#\n])/gm, "$1 $2");

  // 7. Ensure empty line before headings so CommonMark treats them as headings
  cleaned = cleaned.replace(/([^\n])\n(#{1,6}\s+[^\n]+)/g, "$1\n\n$2");

  // 8. Ensure empty line before bullet and numbered lists
  cleaned = cleaned.replace(/([^\n])\n([-*+]\s+[^\n]+)/g, "$1\n\n$2");
  cleaned = cleaned.replace(/([^\n])\n(\d+\.\s+[^\n]+)/g, "$1\n\n$2");

  // 9. Ensure horizontal rules have clean spacing
  cleaned = cleaned.replace(/([^\n])\n(---+)\n/g, "$1\n\n$2\n\n");

  // 10. Ensure MCQ options A., B., C., D. are separated onto their own lines
  cleaned = cleaned.replace(/([^\n])\s+((?:[-*+]\s+)?(?:\*\*)?(?:\()?([A-D])(?:\)|\.|:)?(?:\*\*)?\s+)/g, "$1\n\n$2");

  // 11. Ensure key callout labels start on their own lines
  cleaned = cleaned.replace(
    /([^\n])\s+(\*\*(?:Correct answer|Explanation|Difficulty|What it covers|Subtopics|Key Subtopics|Key Concepts|Why this difficulty|Study tip):\*\*)/gi,
    "$1\n\n$2"
  );

  // 12. Ensure tables have empty line before table header
  cleaned = cleaned.replace(/([^\n])\n(\|.+?\|)\n/g, "$1\n\n$2\n");

  return cleaned;
}

/**
 * Parses raw MCQ text into structured question cards.
 * Handles variations in question headings, option formats (- A., * A., **A.**, (A), A.), and answer notations.
 */
export function parseMCQs(text) {
  if (!text || typeof text !== "string") return [];

  const clean = text
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  // Split on Question headers or horizontal rule dividers followed by question headers
  const parts = clean.split(
    /(?:^|\n)(?=(?:---\s*)?(?:###\s*(?:Question\s*)?\d+|\*\*(?:Question\s*)?\d+[.:]?|\bQuestion\s+\d+[:.]?|\d+\.\s+(?=[A-Z\d])))(?:---\s*)?/i
  );

  // Matches options: "A. text", "- A. text", "* A. text", "**A.** text", "**A)** text", "(A) text", "A) text"
  const optionRegex = /(?:^|\n)\s*(?:[-*+]\s+)?(?:\*\*)?(?:\()?([A-D])(?:\)|\.|:)?(?:\*\*)?\s+([^\n]+)/g;

  const questions = [];

  for (const part of parts) {
    if (!part.trim()) continue;

    const optionMatches = [...part.matchAll(optionRegex)];

    // Must have at least 2 distinct options (typically 4)
    if (optionMatches.length >= 2) {
      // Find where options start to isolate question text
      const firstOptionIndex = optionMatches[0].index;
      const rawQBlock = part.slice(0, firstOptionIndex).trim();

      // Clean headers from question text (### Question 1, **Question 1:**, 1., etc.)
      let qText = rawQBlock
        .replace(/^(?:###\s*(?:Question\s*)?\d+[:.]?|\*\*(?:Question\s*)?\d+[.:]?\s*|\bQuestion\s+\d+[:.]?|\d+\.\s+)/i, "")
        .replace(/^[*#\s\d.:]+/, "")
        .replace(/\*\*/g, "")
        .trim();

      // If question text was inline after header
      if (!qText && rawQBlock) {
        qText = rawQBlock.replace(/^[#*\s]+/, "").trim();
      }

      // Filter options: take up to 4 options (A, B, C, D)
      const options = [];
      const seenLabels = new Set();
      for (const m of optionMatches) {
        const label = m[1].toUpperCase();
        if (!seenLabels.has(label) && ["A", "B", "C", "D"].includes(label)) {
          seenLabels.add(label);
          // Clean any leftover markdown trailing characters
          const optText = m[2].trim().replace(/^[*_\s]+|[*_\s]+$/g, "");
          options.push({ label, text: optText });
        }
      }

      // Correct answer match: matches "**Correct answer:**", "**Answer:**", "Answer:", "Correct Option:", etc.
      const answerMatch =
        part.match(/\*\*(?:Correct\s+)?(?:Answer|Option):\*\*\s*([^\n]+)/i) ||
        part.match(/(?:Correct\s+)?(?:Answer|Option):\s*([^\n]+)/i) ||
        part.match(/\bAnswer:\s*([^\n]+)/i);

      const rawAnswer = answerMatch ? answerMatch[1].trim() : "";
      const letterMatch = rawAnswer.match(/(?:^|[^A-Za-z])([A-D])(?:\b|\.|\))/i);
      const correctLetter = letterMatch ? letterMatch[1].toUpperCase() : "";

      // Explanation match: matches "**Explanation:**", "**Why:**", etc.
      const expMatch =
        part.match(
          /\*\*(?:Explanation|Why|Reason):\*\*\s*([\s\S]+?)(?=(?:---|###|\*\*(?:Question|\d+\.)|$))/i
        ) ||
        part.match(
          /(?:Explanation|Why|Reason):\s*([\s\S]+?)(?=(?:---|###|\*\*(?:Question|\d+\.)|$))/i
        );

      let explanation = expMatch ? expMatch[1].replace(/---+/g, "").trim() : "";
      explanation = explanation.replace(/^[*_\s]+|[*_\s]+$/g, "");

      if (qText && options.length >= 2) {
        questions.push({
          id: questions.length + 1,
          question: qText,
          options,
          correctLetter,
          correctAnswerText: rawAnswer,
          explanation,
        });
      }
    }
  }

  return questions;
}

/**
 * Parses raw topic analysis markdown into structured topic cards.
 */
export function parseTopics(text) {
  if (!text || typeof text !== "string") return [];

  const clean = text.replace(/<br\s*\/?>/gi, "\n");
  const parts = clean.split(/(?=^##\s+(?:\d+[.:]\s*)?[^\n]+)/m);

  const topics = [];

  for (const part of parts) {
    if (!part.trim()) continue;

    const titleMatch = part.match(/^##\s+(?:\d+[.:]\s*)?([^\n]+)/m);
    if (!titleMatch) continue;

    const rawTitle = titleMatch[1].trim();
    if (/analysis|overview|summary/i.test(rawTitle) && !/difficulty:/i.test(part)) {
      continue;
    }

    const diffMatch = part.match(/\*\*Difficulty:\*\*\s*\[?([A-Za-z]+)\]?/i);
    const difficulty = diffMatch ? diffMatch[1].trim() : "Medium";

    const whyMatch = part.match(
      /\*\*(?:Why this difficulty|Why):\*\*\s*([^\n]+(?:\n[^\n*]+)*)/i
    );
    const why = whyMatch ? whyMatch[1].trim() : "";

    const coversMatch = part.match(
      /\*\*(?:What it covers|Covers|Overview):\*\*\s*([^\n]+(?:\n[^\n*]+)*)/i
    );
    const covers = coversMatch ? coversMatch[1].trim() : "";

    const subtopicsMatch = part.match(
      /\*\*(?:Key\s+)?(?:Subtopics|Concepts):\*\*\s*([\s\S]+?)(?=(?:\*\*Study tip|\*\*Why|---|##|$))/i
    );
    const subtopics = [];
    if (subtopicsMatch) {
      const items = subtopicsMatch[1].matchAll(/[-*]\s*([^\n]+)/g);
      for (const item of items) {
        subtopics.push(item[1].trim());
      }
    }

    const tipMatch = part.match(
      /\*\*(?:Study tip|Tip):\*\*\s*([^\n]+(?:\n[^\n*]+)*)/i
    );
    const tip = tipMatch ? tipMatch[1].replace(/---+/g, "").trim() : "";

    if (rawTitle && (diffMatch || covers || subtopics.length > 0)) {
      topics.push({
        id: topics.length + 1,
        title: rawTitle.replace(/^[*_]+|[*_]+$/g, ""),
        difficulty,
        why,
        covers,
        subtopics,
        tip,
      });
    }
  }

  return topics;
}

/**
 * Parses raw flashcards markdown into structured card objects.
 */
export function parseFlashcards(text) {
  if (!text || typeof text !== "string") return [];

  const clean = text.replace(/<br\s*\/?>/gi, "\n");
  const parts = clean.split(/(?=###\s*(?:Card\s*)?\d+|\*\*(?:Card\s*)?\d+[.:])/i);
  const cards = [];

  for (const part of parts) {
    if (!part.trim()) continue;

    const frontMatch = part.match(/\*\*Front:\*\*\s*([^\n]+(?:\n[^\n*]+)*)/i);
    const backMatch = part.match(/\*\*Back:\*\*\s*([\s\S]+?)(?=(?:---|###|\*\*Card|$))/i);

    if (frontMatch && backMatch) {
      cards.push({
        id: `card-${cards.length + 1}-${Date.now()}`,
        front: frontMatch[1].trim(),
        back: backMatch[1].replace(/---+/g, "").trim(),
        status: "new",
        rating: null,
        intervalDays: 1,
        reviewCount: 0,
      });
    }
  }

  return cards;
}
