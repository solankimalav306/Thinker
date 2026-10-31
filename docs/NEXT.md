# Next up (logged 2026-10-31)

The artifact workflow was rebuilt today (kinds drawn from data, a separate identify/generate/check path in the agent, maths,
saved progress). It is committed but unfinished. Plan for the next session:

1. ~~Open an artifact in a tab~~ (done 2026-10-31: "Open in a tab" on every chat card; the tab has Export to HTML, PDF, PNG, Word and PowerPoint
   and Save to Artifacts). Still to do: richer creation from the tab, for example "make slides or a report from this" with the AI.
2. ~~Custom interactive page~~ (done 2026-10-31: separate page builder, update-in-place, sealed script frame with heartbeat watchdog,
   navigation/WebRTC/request blocking; see docs/ARTIFACTS.md "Web pages"). Still to do: guest page cannot run script pages, PDF/PNG/Word/PPT
   export of a script page, "make slides or a report from this" with the AI.
3. ~~Finish checking~~ the narrow-panel charts and diagrams and the all-kinds click-through: done, all pass. The pie chart has only been seen in code.
4. **Sharing**: the guest page shows only page-style artifacts; data-based ones need the guest page to draw them (the server now serves
   the files the frame needs).
5. **Exports** for each kind (PDF, PNG, Word, PowerPoint) checked one by one.
6. Update docs/ARTIFACTS.md, the Help topic and screenshots; rebuild the installer; push.
