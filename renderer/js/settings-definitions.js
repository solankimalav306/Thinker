import { registerSetting } from "./settings-registry.js";

// Adding an option is one entry here: it shows up in Preferences, can be searched and reset,
// and is available through getSetting(key).
export function registerAllSettings() {
  registerSetting({
    key: "reading.rememberPosition",
    label: "Remember where I stopped",
    description: "Reopen each document on the page, zoom and view mode you last used.",
    type: "boolean",
    default: true,
    group: "Reading"
  });
  registerSetting({
    key: "reading.defaultViewMode",
    label: "Default view",
    description: "How documents open the first time.",
    type: "enum",
    options: [
      { value: "single", label: "Single page" },
      { value: "two", label: "Two pages" },
      { value: "scroll", label: "Continuous scroll" }
    ],
    default: "single",
    group: "Reading"
  });
  registerSetting({
    key: "reading.defaultZoom",
    label: "Default zoom (%)",
    description: "Zoom used the first time a document opens.",
    type: "number",
    min: 25,
    max: 500,
    default: 135,
    group: "Reading"
  });
  registerSetting({
    key: "annotation.author",
    label: "Annotation author",
    description: "Name stored on highlights, pen strokes and notes you save into a PDF.",
    type: "string",
    default: "Thinker",
    group: "Annotations"
  });
  registerSetting({
    key: "ai.defaultMode",
    label: "Answer source",
    description: "Auto uses the document first and adds general AI knowledge; Document only answers strictly from the PDF.",
    type: "enum",
    options: [
      { value: "auto", label: "Auto: document + AI knowledge" },
      { value: "document", label: "Document only" }
    ],
    default: "auto",
    group: "AI"
  });
  registerSetting({
    key: "ai.showTokenCounter",
    label: "Show token counter in chat",
    description: "Tokens used by the last request, shown under the chat box.",
    type: "boolean",
    default: true,
    group: "AI"
  });
}
