// Makes sure a PDF has been indexed for search, without opening it in the reader.
// The reader indexes a document when it is opened; a Thinkspace chat may need documents that have not been.
import { toPdfSource } from "./pdf-controller.js";

// Resolves to the document's id once its index exists. `onProgress(done, total)` reports page extraction.
export async function ensureIndexed(path, { api = window.electronAPI, onProgress = () => {} } = {}) {
  const pdfId = await api.getPdfId(path);
  const storagePath = await api.getUserDataPath();

  // a cheap question tells whether the index is already there
  const probe = await api.queryPDF({ query: "index check", pdfId, storagePath, k: 1 });
  if (probe?.ok && !probe.result?.error) return pdfId;

  const doc = await pdfjsLib.getDocument({ url: toPdfSource(path) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push({ page: i, text: content.items.map((item) => item.str).join(" ") });
    onProgress(i, doc.numPages);
  }
  const result = await api.indexPDF({ path, pages, pdfId, storagePath });
  if (!result?.ok) throw new Error(result?.error || "Indexing failed");
  return pdfId;
}
