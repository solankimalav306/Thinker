# Next up (logged 2026-10-31)

The artifact workflow was rebuilt today (kinds drawn from data, a separate identify/generate/check path in the agent, maths,
saved progress). It is committed but unfinished. Plan for the next session:

1. **Open an artifact in a tab** instead of the "Open larger" window. The same tab is where to make a PPT, a document or anything
   else from it (export and richer creation).
2. **Custom interactive page** (the model writes its own HTML and script) as a last kind: runs only after the person clicks Run, in a
   stricter sealed frame: no network, no pop-ups, stopped if it freezes, frame navigation and WebRTC blocked.
3. **Finish checking** the narrow-panel charts and diagrams (sized to the room, flowcharts flip to top-to-bottom), the pie legend, and
   the all-kinds click-through test.
4. **Sharing**: the guest page shows only page-style artifacts; data-based ones need the guest page to draw them (the server now serves
   the files the frame needs).
5. **Exports** for each kind (PDF, PNG, Word, PowerPoint) checked one by one.
6. Update docs/ARTIFACTS.md, the Help topic and screenshots; rebuild the installer; push.
