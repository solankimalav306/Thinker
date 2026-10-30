// One place where every AI feature reports what a request cost: it is added to the history (for the Settings
// summary, labelled by where it came from) and shown on every token counter in the app.
import { recordTokenUsage, updateTokenTracker } from "./token-usage.js";

// Anything a provider or the backend may send, as { prompt_tokens, response_tokens, total_tokens }.
export function normalizeUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);
  const prompt = num(raw.prompt_tokens ?? raw.promptTokenCount ?? raw.input_tokens);
  const total = num(raw.total_tokens ?? raw.totalTokenCount);
  const response = num(raw.response_tokens ?? raw.candidatesTokenCount ?? raw.completion_tokens ?? raw.output_tokens) || (total > prompt ? total - prompt : 0);
  if (!prompt && !response) return null;
  return { ...raw, prompt_tokens: prompt, response_tokens: response, total_tokens: prompt + response };
}

// Where the work happened, in words a person would use.
export const SOURCES = ["Reader chat", "Thinkspace chat", "ThinkerTex", "Other"];

export async function trackAiUsage({ source = "Other", profile = null, usage, pdfId = "" }) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return null;
  for (const tracker of document.querySelectorAll(".token-tracker")) updateTokenTracker(tracker, normalized);
  try {
    await recordTokenUsage({
      profileId: profile?.id || normalized.profile_id || "default",
      profileLabel: profile?.label || "Unknown",
      usage: normalized,
      pdfId,
      source
    });
  } catch { /* the history is a convenience; an answer is never held back by it */ }
  window.dispatchEvent(new CustomEvent("thinker:usage"));
  return normalized;
}

// A small "Tokens: …" line to put inside a panel; it follows the same show/hide setting as the one in the reader.
export function createUsageLine(className = "") {
  const line = document.createElement("span");
  line.className = `token-tracker ${className}`.trim();
  line.title = "Tokens used by the last answer";
  line.textContent = "Tokens: 0";
  if (document.body.classList.contains("hide-token-counter")) line.hidden = true;
  return line;
}
