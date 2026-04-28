const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
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

async function handleLLMGenerate(_event, payload) {
  if (typeof fetchFn !== "function") {
    return { ok: false, error: "Fetch is not available in this Electron runtime." };
  }

  const profile = payload?.profile || {};
  const format = String(profile.format || payload?.format || "gemini").toLowerCase();
  const model = String(profile.model || payload?.model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const apiKey = String(profile.key || profile.apiKey || payload?.apiKey || process.env.GEMINI_API_KEY || "").trim();
  const endpointUrl = normalizeUrl(profile.url || payload?.url || "");
  const parts = Array.isArray(payload?.parts) ? payload.parts : [];

  try {
    if (format === "openai" || format === "openai-compatible") {
      const endpoint = endpointUrl || DEFAULT_OPENAI_URL;
      const body = {
        model,
        messages: [
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
        body: JSON.stringify(body)
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

    let endpoint = endpointUrl || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    if (!endpointUrl) {
      endpoint += `?key=${encodeURIComponent(apiKey)}`;
    } else if (apiKey && !endpoint.includes("key=")) {
      const url = new URL(endpoint);
      if (url.hostname.includes("googleapis.com") || url.searchParams.has("key")) {
        url.searchParams.set("key", apiKey);
        endpoint = url.toString();
      }
    }

    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ contents: [{ parts: geminiParts }] })
    });

    const responseText = await readResponseText(response);
    if (!response.ok) {
      return { ok: false, error: responseText || `Gemini request failed (${response.status})` };
    }

    const parsed = safeJsonParse(responseText);
    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: error?.message || "LLM request failed." };
  }
}

module.exports = { handleLLMGenerate };
