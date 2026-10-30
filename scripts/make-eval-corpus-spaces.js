// Builds the three PDFs the Thinkspace evaluation asks about: node scripts/make-eval-corpus-spaces.js <outDir>
// They overlap on purpose: two documents give different answers to the same question, and some facts
// exist in only one document, so wrong attribution can be caught. evals/space-questions.json matches this text.
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const out = path.resolve(process.argv[2] || 'evals/corpus-spaces');
fs.mkdirSync(out, { recursive: true });

const DOCS = {
  'Operations Manual 2023.pdf': {
    title: 'Operations Manual 2023',
    pages: [
      { h: 'Operations Manual 2023', body: ['Harbor Lights Shipping, internal edition. Issued January 2023.', 'This manual covers drills, fuel planning and crew rules for the fleet of 14 vessels.'] },
      { h: 'Safety drills', body: ['Lifeboat drills are held every 30 days on every vessel.', 'Fire extinguishers are inspected every 6 months.', 'The muster station is where crew assemble in an emergency.'] },
      { h: 'Fuel planning', body: ['At 14 knots a container ship burns 42 tonnes of fuel per day. At 10 knots it burns 18 tonnes per day.', 'Slow steaming is approved by the Operations Desk only.'] }
    ]
  },
  'Safety Bulletin 2024.pdf': {
    title: 'Safety Bulletin 2024',
    pages: [
      { h: 'Safety Bulletin 2024', body: ['Issued March 2024 to all Harbor Lights vessels. This bulletin changes some rules in the Operations Manual 2023.'] },
      { h: 'Changes to drills', body: ['From 1 March 2024 lifeboat drills are held every 14 days.', 'All crew must reach their muster station within 8 minutes of the alarm.', 'Fire extinguishers are now inspected every month.'] }
    ]
  },
  'Port Authority Handbook.pdf': {
    title: 'Port Authority Handbook',
    pages: [
      { h: 'Port Authority Handbook', body: ['Rules for vessels calling at the port of Rotterdam. Published by the Port Authority.'] },
      { h: 'Fees and pilotage', body: ['The port fee per call for a container ship is 12,400 EUR.', 'Pilotage is mandatory for every vessel longer than 150 metres.', 'The maximum speed inside the port limits is 6 knots.'] }
    ]
  }
};

function wrap(text, font, size, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) { lines.push(line); line = word; } else { line = test; }
  }
  if (line) lines.push(line);
  return lines;
}

(async () => {
  for (const [file, doc] of Object.entries(DOCS)) {
    const pdf = await PDFDocument.create();
    pdf.setTitle(doc.title);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    doc.pages.forEach((p, i) => {
      const page = pdf.addPage([612, 792]);
      page.drawText(p.h, { x: 56, y: 720, size: 22, font: bold, color: rgb(0.1, 0.1, 0.15) });
      let y = 680;
      for (const para of p.body) {
        for (const line of wrap(para, font, 12, 500)) { page.drawText(line, { x: 56, y, size: 12, font }); y -= 18; }
        y -= 8;
      }
      page.drawText(`${doc.title} · page ${i + 1}`, { x: 56, y: 40, size: 9, font, color: rgb(0.45, 0.45, 0.5) });
    });
    fs.writeFileSync(path.join(out, file), await pdf.save());
  }
  console.log('wrote', Object.keys(DOCS).length, 'PDFs to', out);
})();
