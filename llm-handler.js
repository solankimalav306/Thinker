const { resolveSecrets, hasUnresolvedSecret, KEY_UNLOCK_ERROR } = require("./secrets");

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const fetchFn = globalThis.fetch;

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  try {
    return new URL(raw).toString();
  } catch {
    return "";
  }
}

function toOpenAIContent(parts = []) {
  return parts.map((part) => {
    if (part?.text) {
      return { type: "text", text: String(part.text) };
    }

    if (part?.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      return {
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${part.inlineData.data}`
        }
      };
    }

    return { type: "text", text: "" };
  });
}

function toGeminiParts(parts = []) {
  return parts.flatMap((part) => {
    if (part?.text) {
      return [{ text: String(part.text) }];
    }

    if (part?.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || "image/png";
      return [{ inline_data: { mime_type: mimeType, data: part.inlineData.data } }];
    }

    return [];
  });
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function handleLLMGenerate(_event, rawPayload) {
  const payload = resolveSecrets(rawPayload);
  if (hasUnresolvedSecret(payload)) {
    return { ok: false, error: KEY_UNLOCK_ERROR };
  }
  if (typeof fetchFn !== "function") {
    return { ok: false, error: "Fetch is not available in this Electron runtime." };
  }

  const profile = payload?.profile || {};
  const format = String(profile.format || payload?.format || "gemini").toLowerCase();
  const model = String(profile.model || payload?.model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const apiKey = String(profile.key || profile.apiKey || payload?.apiKey || "").trim();
  const endpointUrl = normalizeUrl(profile.url || payload?.url || "");
  const parts = Array.isArray(payload?.parts) ? payload.parts : [];
  // Long answers (a whole LaTeX section) need more room than a short reply. Callers may ask for more.
  const maxTokens = Math.max(64, Math.min(Number(payload?.maxTokens) || 512, 16000));
  const system = typeof payload?.system === "string" ? payload.system.slice(0, 20000) : "";
  const wantJson = payload?.json === true;
  const signal = AbortSignal.timeout(Number(payload?.timeoutMs) > 0 ? Math.min(Number(payload.timeoutMs), 300000) : 120000);

  try {
    if (format === "openai" || format === "openai-compatible") {
      const endpoint = endpointUrl || DEFAULT_OPENAI_URL;
      const body = {
        model,
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          {
            role: "user",
            content: toOpenAIContent(parts)
          }
        ]
      };

      const response = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(body),
        signal
      });

      const responseText = await readResponseText(response);
      if (!response.ok) {
        return { ok: false, error: responseText || `OpenAI-compatible request failed (${response.status})` };
      }

      const parsed = safeJsonParse(responseText);
      const text = parsed?.choices?.[0]?.message?.content || parsed?.output_text || "";
      return { ok: true, text };
    }

    const geminiParts = toGeminiParts(parts);
    if (!apiKey && !endpointUrl) {
      return { ok: false, error: "Missing API key for Gemini." };
    }

    const endpoint = endpointUrl || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-goog-api-key": apiKey } : {})
      },
      body: JSON.stringify({
        contents: [{ parts: geminiParts }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { maxOutputTokens: maxTokens, ...(wantJson ? { responseMimeType: "application/json" } : {}) }
      }),
      signal
    });

    const responseText = await readResponseText(response);
    if (!response.ok) {
      return { ok: false, error: responseText || `Gemini request failed (${response.status})` };
    }

    const parsed = safeJsonParse(responseText);
    // Join every text part except the model's private "thought" parts.
    const text = (parsed?.candidates?.[0]?.content?.parts || []).filter((p) => p && typeof p.text === "string" && !p.thought).map((p) => p.text).join("") || "";
    const usage = parsed?.usageMetadata || null;
    return { ok: true, text, usage };
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") return { ok: false, error: "The AI service took too long to answer (timed out)." };
    return { ok: false, error: error?.message || "LLM request failed." };
  }
}

module.exports = { handleLLMGenerate };
