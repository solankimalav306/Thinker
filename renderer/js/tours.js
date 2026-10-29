// The tours, as plain data. `ctx` gives steps the few app actions they need to put the right screen
// in front of the person before a control is spotlighted.

export function buildTours(ctx) {
  const welcome = [
    {
      id: "hello",
      title: "Welcome to Thinker",
      body: "A reading desk for your PDFs. Open one, ask it questions, and mark up what matters. Here is a one-minute tour; you can skip it any time.",
      cta: "Show me around",
      before: () => ctx.goHome()
    },
    {
      id: "open",
      target: "#welcome-open-btn",
      title: "Open a PDF",
      body: "Click here or press Ctrl+O. Recent files wait for you below, and Thinker remembers the page and zoom where you stopped.",
      placement: "bottom"
    },
    {
      id: "model",
      target: "#welcome-settings-btn",
      title: "Connect an AI model",
      body: "Thinker answers with a model you choose: paste a free Gemini key, or use one running on your own computer. Keys are encrypted and stay on this machine.",
      placement: "bottom"
    },
    {
      id: "rail",
      target: ".activity-bar",
      title: "Your toolbox",
      body: "Home, Reader and Settings are always here. Once a document is open, panels for Contents, Pages, Notes, Glossary, Mind maps and History join them.",
      placement: "right"
    },
    {
      id: "help",
      target: "#nav-help",
      title: "Help is always one click away",
      body: "Guides, keyboard shortcuts and answers to common questions live under Help. You can replay this tour from there too.",
      placement: "right",
      cta: "Got it"
    }
  ];

  const reader = [
    {
      id: "move",
      target: ".toolbar-center .tool-group:first-child",
      title: "Move around",
      body: "Use the arrows or your keyboard to turn pages, type a page number or zoom, or pinch on a trackpad. Your page and zoom are remembered the next time you open this file.",
      placement: "bottom",
      before: () => ctx.goReader()
    },
    {
      id: "select",
      target: "#text-layer span, .pdf-page-text-layer span",
      title: "Select text for more",
      body: "Drag over any text like this. Right-click it to copy, define a word or add it to your glossary, and it is quoted in the chat so you can ask about just that passage.",
      placement: "bottom",
      padding: 10
    },
    {
      id: "marks",
      target: "#pen-1",
      title: "Mark it up",
      body: "Pens and highlighters draw right on the page. Click a tool, drag, then click it again (or press Esc) to go back to selecting text.",
      placement: "bottom"
    },
    {
      id: "sticky",
      target: "#sticky-note-btn",
      title: "Sticky notes",
      body: "Click this, then click the page to drop a note exactly where you need it.",
      placement: "bottom"
    },
    {
      id: "save",
      target: "#save-annotations-btn",
      title: "Save your marks",
      body: "This makes a new PDF with real annotations that open in Acrobat and other readers. Your original file is never changed.",
      placement: "bottom"
    },
    {
      id: "panels",
      target: "#nav-notes",
      title: "Notes, glossary and mind maps",
      body: "Notes keeps what you save from chats. Defined words build your glossary. Mind maps draw the structure of a document. They all live in these panels.",
      placement: "right"
    },
    {
      id: "chat",
      target: "#chat-panel",
      title: "Ask Thinker",
      body: "Ask anything about the document. Answers name the pages they came from; click a page chip to jump straight there.",
      placement: "left",
      before: () => ctx.openChat()
    },
    {
      id: "source",
      target: "#chat-mode-select",
      title: "Choose where answers come from",
      body: "Document + AI may add general knowledge, always marked clearly. Document only sticks strictly to your PDF and says so when it can't find something.",
      placement: "top"
    },
    {
      id: "chats",
      target: "#conversation-bar",
      title: "Keep chats tidy",
      body: "Start a new chat for a new topic. Click the chat's name to search, pin, rename or delete your chats for this document.",
      placement: "bottom"
    },
    {
      id: "instructions",
      target: "#instructions-btn",
      title: "Teach it your style",
      body: "Add instructions like \"be brief\" or \"explain it like a tutor\": everywhere, for one document, or for one chat. There are presets to start from.",
      placement: "top",
      cta: "Finish"
    }
  ];

  return {
    welcome: { id: "welcome", label: "Welcome tour", steps: welcome },
    reader: { id: "reader", label: "Reader tour", steps: reader }
  };
}
