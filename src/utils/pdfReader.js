
import * as pdfjsLib from "pdfjs-dist";

// Use PDF.js's bundled worker so PDF processing works in Vite.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export async function extractTextFromPDF(file) {
  if (!(file instanceof File)) {
    throw new Error("Please select a valid PDF file.");
  }

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Please upload a PDF file.");
  }

  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
  }).promise;

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    const pageText = content.items
      .filter((item) => "str" in item)
      .map((item) => item.str)
      .join(" ");

    pages.push(`--- Page ${pageNumber} ---\n${pageText}`);
  }

  const text = pages.join("\n\n").trim();

  if (!text) {
    throw new Error(
      "No selectable text was found. This PDF may contain scanned images and need OCR."
    );
  }

  return {
    fileName: file.name,
    pageCount: pdf.numPages,
    text,
  };
}
