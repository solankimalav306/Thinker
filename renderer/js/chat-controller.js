const DEFAULT_CHAT_MODEL = "gemini-2.5-flash-lite";

function markdownToHtml(text) {
  if (window.marked) {
    return window.marked.parse(text);
  }
  return String(text || "").replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export class ChatController {
  constructor(options) {
    this.chatHistory = options.chatHistory;
    this.chatInput = options.chatInput;
    this.chatSend = options.chatSend;
    this.selectedTextBox = options.selectedTextBox;
    this.imagePreviewContainer = options.imagePreviewContainer;
    this.onStatus = options.onStatus;
    this.getChatConfig = options.getChatConfig;

    this.attachedImage = null;
    this.activePdfPath = null;
    this.enabled = true;
    this.entries = [];
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.chatInput.disabled = !enabled;
    this.chatSend.disabled = !enabled;
    if (!enabled) {
      this.chatInput.blur();
    }
  }

  resetUi() {
    this.chatHistory.innerHTML = "";
    this.clearSelectedText();
    this.clearAttachment();
  }

  appendMessage(sender, text, image = null) {
    const msg = document.createElement("div");
    msg.className = sender === "You" ? "user-msg" : "bot-msg";

    let html = "";
    if (image) {
      html += `<img src="${image}" style="max-width:100%; border-radius:8px; margin-bottom:8px;" alt="Attachment">`;
    }

    html += markdownToHtml(text);
    msg.innerHTML = html;
    this.chatHistory.appendChild(msg);
    this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
  }

  appendUserMessage(question, quoteText, image = null) {
    const msg = document.createElement("div");
    msg.className = "user-msg";

    let html = "";
    if (image) {
      html += `<img src="${image}" style="max-width:100%; border-radius:8px; margin-bottom:8px;" alt="Attachment">`;
    }

    if (quoteText) {
      html += `<blockquote class="chat-quote">${escapeHtml(quoteText)}</blockquote>`;
    }

    html += `<div class="chat-question">${escapeHtml(question)}</div>`;
    msg.innerHTML = html;

    this.chatHistory.appendChild(msg);
    this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
  }

  setSelectedText(text) {
    if (!text) {
      this.selectedTextBox.textContent = "";
      this.selectedTextBox.style.display = "none";
      return;
    }

    this.selectedTextBox.textContent = text;
    this.selectedTextBox.style.display = "";
  }

  clearSelectedText() {
    this.setSelectedText("");
  }

  attachImage(dataUrl) {
    this.attachedImage = dataUrl;
    this.imagePreviewContainer.innerHTML = `
      <img src="${dataUrl}" alt="Screenshot preview" />
      <button id="remove-image-btn" title="Remove image">x</button>
    `;
    this.imagePreviewContainer.style.display = "block";
    const removeBtn = document.getElementById("remove-image-btn");
    removeBtn.addEventListener("click", () => this.clearAttachment());
  }

  clearAttachment() {
    this.attachedImage = null;
    this.imagePreviewContainer.innerHTML = "";
    this.imagePreviewContainer.style.display = "none";
  }

  async loadPdfHistory(pdfPath) {
    this.activePdfPath = pdfPath;
    this.entries = [];
    this.resetUi();

    if (!window.electronAPI || !window.electronAPI.loadChatHistory || !pdfPath) {
      return;
    }

    const loaded = await window.electronAPI.loadChatHistory(pdfPath);
    this.entries = Array.isArray(loaded) ? loaded : [];

    this.entries.forEach((entry) => {
      if (entry.role === "user") {
        this.appendUserMessage(entry.question || entry.text || "", entry.quote || "", null);
      } else {
        this.appendMessage("Bot", entry.text || "");
      }
    });
  }

  async persistEntry(entry) {
    if (!window.electronAPI || !window.electronAPI.appendChatEntry || !this.activePdfPath) {
      return;
    }

    await window.electronAPI.appendChatEntry({
      pdfPath: this.activePdfPath,
      entry
    });
  }

  summarizeContext() {
    if (this.entries.length === 0) {
      return "No prior conversation.";
    }

    const recent = this.entries.slice(-16).map((entry) => {
      const prefix = entry.role === "user" ? "User" : "Assistant";
      const text = (entry.text || "").replace(/\s+/g, " ").trim();
      return `${prefix}: ${text.slice(0, 220)}`;
    });

    const summary = recent.join("\n");
    return summary.length > 1800 ? summary.slice(summary.length - 1800) : summary;
  }

  getChatConfigOrPrompt() {
    const config = this.getChatConfig ? this.getChatConfig() : null;

    if (config?.profile) {
      return config;
    }

    if (config?.apiKey) {
      return config;
    }

    const entered = window.prompt("Enter API key (optional for local or profile-based providers):");
    if (entered && entered.trim()) {
      return {
        apiKey: entered.trim(),
        profile: { format: "gemini", model: config?.model || DEFAULT_CHAT_MODEL, key: entered.trim() },
        model: config?.model || DEFAULT_CHAT_MODEL,
        apiKeyLabel: "Manual key"
      };
    }

    return {
      apiKey: "",
      profile: null,
      model: config?.model || DEFAULT_CHAT_MODEL,
      apiKeyLabel: "No profile selected"
    };
  }

  

  async askLLM(parts) {
    const { apiKey, profile, model } = this.getChatConfigOrPrompt();

    if (!profile && !apiKey) {
      throw new Error("Missing AI profile or API key");
    }

    if (window.electronAPI && window.electronAPI.askLLM) {
      const result = await window.electronAPI.askLLM({
        profile: profile || { format: "gemini", key: apiKey, model: model || DEFAULT_CHAT_MODEL },
        model: model || DEFAULT_CHAT_MODEL,
        apiKey,
        parts
      });

      if (!result?.ok) {
        throw new Error(result?.error || "AI request failed");
      }

      return result.text || "No response.";
    }

    throw new Error("AI bridge not available");
  }

  async askGemini(parts) {
    return this.askLLM(parts);
  }

  async sendMessage() {
    if (!this.enabled) {
      this.onStatus("Open a PDF first. Chat is disabled on welcome screen.");
      return;
    }

    const text = this.chatInput.value.trim();
    if (!text && !this.attachedImage) {
      return;
    }

    if (!this.activePdfPath) {
      this.onStatus("Open a PDF tab to chat about it.");
      return;
    }

    const contextText = this.selectedTextBox.textContent.trim();
    const questionText = text;
    const summary = this.summarizeContext();

    this.appendUserMessage(questionText, contextText, this.attachedImage);
    const userEntry = {
      role: "user",
      text: contextText ? `Quote: "${contextText}"\nQuestion: ${questionText}` : questionText,
      question: questionText,
      quote: contextText,
      ts: Date.now()
    };
    this.entries.push(userEntry);
    await this.persistEntry(userEntry);

    const parts = [];
    if (this.attachedImage) {
      parts.push({
        inline_data: {
          mime_type: "image/png",
          data: this.attachedImage.split(",")[1]
        }
      });
    }

    const pdfId = await window.electronAPI.getPdfId(this.activePdfPath);
    const storagePath = await window.electronAPI.getUserDataPath();

    let retrievedChunks = [];

    try {
      const res = await window.electronAPI.queryPDF({
        query: questionText,
        pdfId,
        storagePath
      });

      if (res.ok && res.result && res.result.chunks) {
        retrievedChunks = res.result.chunks;
      } else {
        retrievedChunks = res.chunks || []; // Fallback just in case
      }
    } catch (e) {
      console.error("RAG query failed", e);
    }

    const ragContext = retrievedChunks.map((c, i) => `(${i + 1}) [Page ${c.page}]\n${c.text}`).join("\n\n");

    parts.push({
      text: [
        "You are assisting with a specific PDF document.",
        
        "Use the provided context STRICTLY. Do not hallucinate.",
        
        "",
        "Relevant document context:",
        ragContext || "No relevant context found.",
        
        "",
        "Conversation summary:",
        summary,
        
        "",
        contextText ? `Quoted PDF text:\n${contextText}` : "No explicit quote selected.",
        
        "",
        "Current user message:",
        questionText
      ].join("\n")
    });

    this.chatInput.value = "";
    this.clearAttachment();
    this.clearSelectedText();
    this.onStatus("Waiting for Gemini response...");


    try {
      const reply = await this.askLLM(parts);
      this.appendMessage("Bot", reply);

      const botEntry = {
        role: "assistant",
        text: reply,
        ts: Date.now()
      };
      this.entries.push(botEntry);
      await this.persistEntry(botEntry);
      this.onStatus("Ready.");
    } catch (error) {
      console.error(error);
      this.appendMessage("Bot", `AI request failed: ${error?.message || "Unknown error"}`);
      this.onStatus("AI request failed.");
    }
  }

  bindEvents() {
    this.chatSend.addEventListener("click", () => this.sendMessage());

    this.chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.sendMessage();
      }
    });
  }
}
