// The About card at the bottom of Settings: what Thinker is, which version this is, and what it is built on.
// All text is set with textContent.
const BUILT_ON = [
  ["Electron", "the desktop shell"],
  ["PDF.js", "shows and reads the pages"],
  ["FAISS and BM25", "meaning and word search over your documents"],
  ["multilingual-e5 and mmarco", "the embedding and reranking models that run on this computer"],
  ["LangGraph", "the agent that decides how to answer"],
  ["KaTeX, d3, Markmap, DOMPurify", "maths, charts, mind maps, safe display"],
  ["Tectonic", "compiles LaTeX in ThinkerTex"]
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export async function renderAbout(container, api = window.electronAPI) {
  if (!container) return;
  container.textContent = "";
  let version = "";
  try { version = await api?.getAppVersion?.(); } catch { /* the version is a nicety */ }

  const head = el("div", "card-head");
  head.append(el("h3", null, "About Thinker"), el("span", null, version ? `Version ${version}` : ""));
  container.append(head);

  container.append(el("p", "about-lead", "Thinker is a PDF reader you can ask. It answers from your own documents, points to the page it used, and also makes notes, mind maps, flashcards, quizzes, small web pages and LaTeX projects from them."));

  const facts = el("ul", "about-list");
  for (const text of [
    "Your documents, chats and notes stay on this computer. Only the passages needed for a question are sent, straight to the AI model you chose in Settings.",
    "API keys are encrypted by your operating system and are never shown to the app's pages.",
    "Searching and ranking run locally; the first time, two small language models are downloaded.",
    "Pages the AI writes run in a sealed frame with no internet access and are labelled \"AI-generated\"."
  ]) facts.append(el("li", null, text));
  container.append(facts);

  container.append(el("h4", "about-sub", "Built on"));
  const built = el("ul", "about-list about-built");
  for (const [name, what] of BUILT_ON) {
    const li = el("li");
    li.append(el("strong", null, name), document.createTextNode(` – ${what}`));
    built.append(li);
  }
  container.append(built);
  container.append(el("p", "settings-note", "Open-source software, ISC licence. Each library keeps its own licence."));
}
