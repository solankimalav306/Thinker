// A small guided-tour engine: dims the screen, spotlights one real control at a time and explains it
// in a card. Steps are plain data (see tours.js). Positioning is pure and unit-tested.

const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };

// Where to put a card of size `pop` next to `target` (all in viewport pixels) so it stays on screen.
// With no target the card is centred. Tries the preferred side, then the opposite, then the others.
export function placePopover(target, pop, view, preferred = "bottom", gap = 16, margin = 12) {
  if (!target) {
    return { left: Math.round((view.width - pop.width) / 2), top: Math.round((view.height - pop.height) / 2), placement: "center", arrow: null };
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const centreX = target.left + target.width / 2;
  const centreY = target.top + target.height / 2;

  const attempt = (side) => {
    let left;
    let top;
    if (side === "bottom") {
      top = target.top + target.height + gap;
      left = clamp(centreX - pop.width / 2, margin, view.width - pop.width - margin);
    } else if (side === "top") {
      top = target.top - pop.height - gap;
      left = clamp(centreX - pop.width / 2, margin, view.width - pop.width - margin);
    } else if (side === "right") {
      left = target.left + target.width + gap;
      top = clamp(centreY - pop.height / 2, margin, view.height - pop.height - margin);
    } else {
      left = target.left - pop.width - gap;
      top = clamp(centreY - pop.height / 2, margin, view.height - pop.height - margin);
    }
    const fits = left >= margin && top >= margin && left + pop.width <= view.width - margin && top + pop.height <= view.height - margin;
    return { left, top, fits };
  };

  const order = [preferred, OPPOSITE[preferred], ...["bottom", "right", "left", "top"]]
    .filter((side, i, list) => side && list.indexOf(side) === i);
  for (const side of order) {
    const result = attempt(side);
    if (result.fits) {
      const arrow = side === "top" || side === "bottom"
        ? { side: OPPOSITE[side], offset: Math.round(clamp(centreX - result.left, 20, pop.width - 20)) }
        : { side: OPPOSITE[side], offset: Math.round(clamp(centreY - result.top, 20, pop.height - 20)) };
      return { left: Math.round(result.left), top: Math.round(result.top), placement: side, arrow };
    }
  }

  // Nothing fits (a tiny window or a huge target): sit at the bottom edge, fully visible.
  return {
    left: Math.round(clamp(centreX - pop.width / 2, margin, view.width - pop.width - margin)),
    top: Math.round(Math.max(margin, view.height - pop.height - margin)),
    placement: "bottom",
    arrow: null
  };
}

function isShown(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// steps: [{ id, target?, title, body, placement?, before?(ctx), optional?, padding? }]
// Resolves with { completed, reached } when the tour closes.
export function runTour({ steps, ctx = {}, label = "Tour" }) {
  return new Promise((resolve) => {
    const layer = document.createElement("div");
    layer.className = "tour-layer";
    layer.innerHTML = `
      <div class="tour-spot" aria-hidden="true"></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabindex="-1">
        <div class="tour-arrow" aria-hidden="true"></div>
        <p class="tour-count"></p>
        <h3 id="tour-title" class="tour-title"></h3>
        <p id="tour-body" class="tour-body"></p>
        <div class="tour-dots" aria-hidden="true"></div>
        <div class="tour-actions">
          <button type="button" class="btn tour-skip">Skip tour</button>
          <span class="tour-spacer"></span>
          <button type="button" class="btn tour-back">Back</button>
          <button type="button" class="btn primary tour-next">Next</button>
        </div>
      </div>
      <p class="tour-live" aria-live="polite"></p>`;
    document.body.appendChild(layer);

    const spot = layer.querySelector(".tour-spot");
    const card = layer.querySelector(".tour-card");
    const arrow = layer.querySelector(".tour-arrow");
    const live = layer.querySelector(".tour-live");
    const el = (selector) => layer.querySelector(selector);
    const previouslyFocused = document.activeElement;

    let index = -1;
    let direction = 1;
    let reached = 0;
    let closing = false;
    let busy = false;

    function close(completed) {
      if (closing) return;
      closing = true;
      window.removeEventListener("resize", reposition);
      document.removeEventListener("keydown", onKey, true);
      layer.classList.add("closing");
      setTimeout(() => {
        layer.remove();
        previouslyFocused?.focus?.();
      }, 160);
      resolve({ completed, reached });
    }

    function reposition() {
      const step = steps[index];
      if (!step) return;
      const target = step.target ? document.querySelector(step.target) : null;
      const visible = isShown(target);
      const padding = step.padding ?? 8;
      let box = null;

      if (visible) {
        const rect = target.getBoundingClientRect();
        box = { left: rect.left - padding, top: rect.top - padding, width: rect.width + padding * 2, height: rect.height + padding * 2 };
        spot.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
        spot.hidden = false;
      } else {
        spot.hidden = true;
      }

      const popSize = { width: card.offsetWidth, height: card.offsetHeight };
      const view = { width: window.innerWidth, height: window.innerHeight };
      const placed = placePopover(box, popSize, view, step.placement || "bottom");
      card.style.left = `${placed.left}px`;
      card.style.top = `${placed.top}px`;
      card.dataset.placement = placed.placement;
      if (placed.arrow) {
        arrow.hidden = false;
        arrow.dataset.side = placed.arrow.side;
        arrow.style.cssText = placed.arrow.side === "top" || placed.arrow.side === "bottom"
          ? `left:${placed.arrow.offset}px;top:auto`
          : `top:${placed.arrow.offset}px;left:auto`;
      } else {
        arrow.hidden = true;
      }
    }

    async function show(next, dir) {
      if (busy || closing) return;
      busy = true;
      let i = next;
      // Skip steps whose control is not on screen (for example a panel that is closed).
      while (i >= 0 && i < steps.length) {
        const step = steps[i];
        await step.before?.(ctx);
        await frame();
        await wait(step.settleMs ?? 120);
        const target = step.target ? document.querySelector(step.target) : null;
        if (!step.target || isShown(target)) {
          target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          break;
        }
        if (step.optional === false) break; // required steps show centred instead of vanishing
        i += dir;
      }
      busy = false;

      if (i < 0) i = 0;
      if (i >= steps.length) {
        close(true);
        return;
      }

      index = i;
      direction = dir;
      reached = Math.max(reached, i + 1);
      const step = steps[i];
      el(".tour-count").textContent = steps.length > 1 ? `${label} · ${i + 1} of ${steps.length}` : label;
      el(".tour-title").textContent = step.title;
      el(".tour-body").textContent = step.body;
      el(".tour-back").hidden = i === 0;
      el(".tour-next").textContent = step.cta || (i === steps.length - 1 ? "Done" : "Next");
      el(".tour-dots").innerHTML = steps.map((_, n) => `<span class="${n === i ? "on" : n < i ? "past" : ""}"></span>`).join("");
      live.textContent = `${label}, step ${i + 1} of ${steps.length}: ${step.title}`;
      card.classList.remove("shown");
      reposition();
      requestAnimationFrame(() => {
        reposition();
        card.classList.add("shown");
        el(".tour-next").focus({ preventScroll: true });
      });
    }

    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(false);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        show(index + 1, 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        show(index - 1, -1);
      } else if (event.key === "Tab") {
        // Keep keyboard focus inside the card while the tour is open.
        const focusable = [...card.querySelectorAll("button:not([hidden])")];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!card.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    el(".tour-next").addEventListener("click", () => show(index + 1, 1));
    el(".tour-back").addEventListener("click", () => show(index - 1, -1));
    el(".tour-skip").addEventListener("click", () => close(false));
    layer.addEventListener("mousedown", (event) => {
      // Clicking the dimmed area does nothing: a stray click must not derail the tour.
      if (!card.contains(event.target)) event.preventDefault();
    });
    window.addEventListener("resize", reposition);
    document.addEventListener("keydown", onKey, true);

    show(0, 1);
  });
}
