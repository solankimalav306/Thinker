// Everything the Help screen says, as data. Only describe things that really exist in the app.

export const LINKS = {
  gemini: { label: "Get a free Gemini key", url: "https://aistudio.google.com/apikey" },
  ollama: { label: "Install Ollama (local models)", url: "https://ollama.com/download" },
  openrouter: { label: "OpenRouter keys", url: "https://openrouter.ai/keys" }
};

export const GUIDES = [
  {
    id: "read",
    icon: "fa-book-open",
    title: "Open and read a PDF",
    summary: "Open files, move around and come back to where you stopped.",
    steps: [
      "Click Open a PDF on Home or press Ctrl+O. You can open several files; each gets a tab at the top.",
      "Turn pages with the arrows, or choose Single page, Two pages or Continuous scroll on the right of the toolbar.",
      "Zoom with the magnifier buttons or type a percentage. Fit adjusts the page to the window.",
      "Press Ctrl+F to search the document. Enter jumps to the next match and Shift+Enter to the previous one.",
      "Close the file and open it later: Thinker returns you to the same page and zoom."
    ],
    tip: "Drag a tab out of the window to open that file in its own window.",
    action: { label: "Tour the reader", run: "tour:reader" }
  },
  {
    id: "spaces",
    icon: "fa-layer-group",
    title: "Group your work in a Thinkspace",
    summary: "Keep related PDFs and writing projects together, for a paper, a course or a case.",
    steps: [
      "Click Spaces on the left, then New Thinkspace. Give it a name; click the name any time to change it.",
      "Choose Add PDFs, or drop PDF files onto the page. Use the arrows to put them in the order you want.",
      "Open adds a document to the reader. Remove takes it out of the Thinkspace only; the file is never deleted.",
      "A document can be in several Thinkspaces, and a Thinkspace can have ThinkerTex writing projects too.",
      "Ask the chat beside the documents anything across all of them. Citations such as [Safety Bulletin, p. 2] are buttons that open that PDF at that page.",
      "Ask for a table, timeline, flashcards or a study guide and the answer appears as a styled card. Open it larger, copy it, or export it. A dashed reference means it could not be checked against the sources."
    ],
    tip: "Deleting a Thinkspace never deletes your PDFs or your writing."
  },
  {
    id: "artifacts",
    icon: "fa-shapes",
    title: "Keep tables, charts and slides as Artifacts",
    summary: "Ask in a chat for a table, chart, timeline, flashcards, slides or a one-page summary, then keep it and take it with you.",
    steps: [
      "Ask for it by name in the reader chat or in a Thinkspace chat, for example: Make a comparison table, or Make slides from this.",
      "The answer appears as a card marked AI-generated. Citations on it open the PDF at that page.",
      "Press the bookmark on the card to keep it. Kept artifacts live under Artifacts on the left, apart from the chat they came from.",
      "There you can search, filter by kind, rename, link to a Thinkspace, or delete.",
      "Press the download icon to export as an HTML page, PDF, PNG image, Word document or PowerPoint. A deck also has a Present button: arrow keys move between slides and Escape ends it."
    ],
    tip: "Charts and slides are drawn from the document, but check the numbers: a model can still get one wrong."
  },
  {
    id: "share",
    icon: "fa-share-nodes",
    title: "Share with people on your network",
    summary: "Let someone on the same Wi-Fi or office network look at an artifact, or work on a LaTeX project with you, live.",
    steps: [
      "Open an artifact in Artifacts, or a project in ThinkerTex, and press Share.",
      "Choose who can reach it and for how long, then press Start sharing. Windows may ask once about the network: choose Private networks.",
      "Send them the link. Read out a 6-digit code; they type it in on the page. Both are needed.",
      "For a project you can tick Let people edit this project with me. You then get two codes: the edit code lets someone change the text files and run a build, the view code lets them only watch.",
      "Everyone types in the same file at once. You see each other's cursors and names, and your project files on your computer always hold the combined result.",
      "Guests see only that one project's text files and its PDF, never anything else on your computer. Artifacts can only be looked at.",
      "Press Stop sharing, or close Thinker, and the link stops working at once. Five wrong codes lock that person out for ten minutes."
    ],
    tip: "Give the edit code only to people you trust: what they type is compiled on your computer. The connection is plain HTTP on your local network, not encrypted, so never use it on public Wi-Fi."
  },
  {
    id: "tex",
    icon: "fa-pen-nib",
    title: "Write LaTeX with ThinkerTex",
    summary: "Write a paper with a live PDF beside it, in code or in a normal writing view, with an AI that writes and checks LaTeX.",
    steps: [
      "Click TeX on the left, then New project, and pick a template. Or open a folder or a .tex file you already have.",
      "The first time, choose Set up now: ThinkerTex downloads the LaTeX packages it needs (about 40 MB). After that it works offline.",
      "Write in Code, or switch to Visual to edit like a normal document: headings, bold, lists, equations, citations.",
      "Press Recompile (or Ctrl+Enter) to see the PDF. Turn on Auto to update it a moment after you stop typing.",
      "Problems appear at the bottom in plain words. Click one to jump to its line, or choose Fix with AI.",
      "Open Ask ThinkerTex and describe what you want. It tries the change on a copy, compiles it, and shows you the difference. Nothing changes until you press Apply."
    ],
    tip: "A project can live anywhere: on its own, in any folder, or inside a Thinkspace, where the AI can also use that Thinkspace's PDFs."
  },
  {
    id: "model",
    icon: "fa-plug",
    title: "Connect an AI model",
    summary: "Thinker uses a model you choose. Your key stays encrypted on this computer.",
    steps: [
      "Open Settings and go to AI models.",
      "Free and quick: get a Gemini key (button below), choose Google Gemini as the provider, paste the key and use a model such as gemini-3.5-flash-lite.",
      "Private: install Ollama, run a model on your computer, then choose OpenAI-compatible and enter its address (for example http://localhost:11434/v1/chat/completions). No key needed.",
      "Click Add model. Use the Use for chat menu to switch between models any time."
    ],
    tip: "With a local model, nothing about your document leaves your computer.",
    links: ["gemini", "ollama", "openrouter"],
    action: { label: "Open Settings", run: "goto:settings" }
  },
  {
    id: "ask",
    icon: "fa-comments",
    title: "Ask questions and read the answers",
    summary: "Chat about the open document and check where each answer came from.",
    steps: [
      "Open the chat with the Ask button in the toolbar and type a question. Press Enter to send.",
      "Select text in the document first to ask about just that passage; it appears above the box as a quote.",
      "Answers name their pages, like Page 3. Click one to jump straight to it.",
      "Document + AI may add general knowledge, always marked AI Knowledge. Document only sticks strictly to your PDF and says so when it can't find something.",
      "Press Stop while it is thinking to cancel. Use Copy or Save as note under an answer to keep it."
    ],
    tip: "If an answer cites a page, open it. Checking the source takes a few seconds.",
    action: { label: "Tour the chat", run: "tour:reader" }
  },
  {
    id: "markup",
    icon: "fa-highlighter",
    title: "Mark up a page",
    summary: "Highlight, draw and leave notes right on the document.",
    steps: [
      "Pick a pen or highlighter in the toolbar, then drag across the page. Colours and widths appear in a strip below the toolbar.",
      "Use the eraser to remove strokes, or the sticky note button and then click the page to leave a note.",
      "When you are done, click the active tool again or press Esc. Selecting text only works with no drawing tool switched on.",
      "Right-click selected text to copy it, define a word or add it to your glossary."
    ],
    tip: "Text won't select? Look for a lit tool in the toolbar. That's the usual reason.",
    action: { label: "Tour the toolbar", run: "tour:reader" }
  },
  {
    id: "save",
    icon: "fa-floppy-disk",
    title: "Save your marks",
    summary: "Make a new PDF that carries your highlights, pen and notes.",
    steps: [
      "Click Save in the toolbar and choose what to include: strokes, AI highlights, sticky notes and research notes.",
      "Leave Flatten off to save real PDF annotations that stay editable in Acrobat, Edge and other readers.",
      "Switch Flatten on only if you want the marks burned into the page.",
      "Choose where to save. Your original file is never changed."
    ],
    tip: "Every save is kept in the History panel, so you can go back to an earlier state.",
    action: null
  },
  {
    id: "notes",
    icon: "fa-note-sticky",
    title: "Notes, glossary and mind maps",
    summary: "Turn what you read into something you can keep.",
    steps: [
      "Save as note under any answer, or ask Thinker to take notes. They collect in the Notes panel.",
      "Select a word, right-click and choose Define to build your glossary. Export it from the Glossary panel.",
      "Ask for a mind map, or click + in the Mind maps panel, to see how the ideas connect. Export it as an image.",
      "Notes can be exported as Markdown, PDF or LaTeX."
    ],
    tip: "Sticky notes you place on pages are listed under Notes, in the Stickies tab.",
    action: null
  },
  {
    id: "chats",
    icon: "fa-sliders",
    title: "Chats and custom instructions",
    summary: "Keep topics separate and tell Thinker how you like answers.",
    steps: [
      "Click New in the chat header to start a fresh chat. Each chat remembers its own conversation.",
      "Click the chat's name to see all chats for this document: search, pin, rename or delete them.",
      "Click Instructions to add guidance such as \"be brief\" or \"explain like a tutor\". Apply it everywhere, to this document or to this chat.",
      "Presets (Study tutor, Legal reader, Researcher, Summarizer) are a quick start."
    ],
    tip: "Instructions add to Thinker's own rules. They can't turn off page citations or Document only.",
    action: null
  },
  {
    id: "yours",
    icon: "fa-palette",
    title: "Make Thinker yours",
    summary: "Theme, accent colour and everyday preferences.",
    steps: [
      "In Settings, open Appearance to choose Light (paper) or Dark (ink), and pick an accent colour.",
      "Under Preferences, search for anything: default view, default zoom, the author name on your annotations, and more.",
      "A reset button appears on anything you have changed, and Changed only shows just those."
    ],
    tip: "Accent colours adjust themselves so button text stays readable.",
    action: { label: "Open Settings", run: "goto:settings" }
  }
];

export const SHORTCUTS = [
  { keys: ["Ctrl", "O"], does: "Open a PDF" },
  { keys: ["Ctrl", "F"], does: "Search inside the open document" },
  { keys: ["Enter"], does: "Next search match, or send your chat message" },
  { keys: ["Shift", "Enter"], does: "Previous search match, or a new line in the chat box" },
  { keys: ["Esc"], does: "Switch off the active tool, close search, a dialog or a menu" },
  { keys: ["←", "→"], does: "Previous and next page (and previous and next step in a tour)" },
  { keys: ["PgDn", "PgUp"], does: "Scroll a screen, and turn the page at the end of it" },
  { keys: ["Space"], does: "Scroll down a screen (Shift + Space scrolls up)" },
  { keys: ["Home", "End"], does: "First and last page" },
  { keys: ["Ctrl", "+", "-"], does: "Zoom in and out (a trackpad pinch works too)" },
  { keys: ["Ctrl", "0"], does: "Fit the page to the window" },
  { keys: ["Ctrl", "G"], does: "Go to a page: type its number and press Enter" },
  { keys: ["Ctrl", "Z"], does: "Undo your last mark; Ctrl + Y brings it back" },
  { keys: ["Ctrl", "S"], does: "Save your marks into a new PDF" },
  { keys: ["Ctrl", "W"], does: "Close the current tab (middle-click on a tab works too)" },
  { keys: ["Ctrl", "Tab"], does: "Switch to the next tab" },
  { keys: ["Ctrl", "Enter"], does: "Compile the LaTeX project (in ThinkerTex)" },
  { keys: ["Ctrl", "B", "I"], does: "Bold and italic in a LaTeX project" },
  { keys: ["Ctrl", "/"], does: "Comment or uncomment lines in the LaTeX code view" },
  { keys: ["Tab"], does: "Move between buttons and fields, with a visible focus ring" }
];

export const FAQ = [
  {
    q: "Is my document uploaded anywhere?",
    a: "Thinker has no server. When you ask a question, only the pages needed to answer it are sent, straight from your computer to the model you chose. With a local model such as Ollama, nothing leaves your computer."
  },
  {
    q: "Where is my data kept?",
    a: "On this computer, in Thinker's data folder: one database for your chats, notes, glossary and settings. API keys are encrypted by your operating system. Your PDFs are never copied or changed."
  },
  {
    q: "Why does Document only say it couldn't find something?",
    a: "That mode answers strictly from the document, so when the text doesn't contain the answer it says so instead of guessing. Switch to Document + AI if you want general knowledge too (it is always marked)."
  },
  {
    q: "Text won't select. What is wrong?",
    a: "A pen, highlighter or eraser is probably switched on. Click the lit tool in the toolbar again, or press Esc, and selecting works again."
  },
  {
    q: "Chat says to connect a model. How do I do that?",
    a: "Open Settings, then AI models. Paste a Gemini key (the free one is fine), or point Thinker at a local model. The Connect an AI model guide above walks through both."
  },
  {
    q: "Can I open a scanned PDF or a locked one?",
    a: "Locked PDFs ask for their password, which is never stored. Scanned pages have no text to read yet, so search, chat and selection can't see them; reading and marking up still work."
  },
  {
    q: "How do I start over with the tutorials?",
    a: "Use the buttons at the top of this page to replay a tour, or show the Get started checklist on Home again."
  }
];
