import "./styles.css";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Content starts visible. Animation enhances it without making reading depend on JS.
function enter(element: Element, delay = 0) {
  if (reducedMotion.matches || typeof element.animate !== "function") return;
  element.animate(
    [
      { opacity: 0, transform: "translateY(24px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 750, delay, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, index) => {
        if (!entry.isIntersecting) return;
        enter(entry.target, Math.min(index, 3) * 70);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12 },
  );
  document.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
}

function animateImage(image: HTMLImageElement) {
  if (reducedMotion.matches) return;
  image.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
}

const heroImage = document.querySelector<HTMLImageElement>("#hero-screenshot");
const themeButtons = document.querySelectorAll<HTMLButtonElement>("[data-theme]");
document.querySelector<HTMLElement>(".theme-picker")?.removeAttribute("hidden");
themeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!heroImage || button.getAttribute("aria-pressed") === "true") return;
    themeButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    heroImage.src = __SITE_IMAGES__[`session-${button.dataset.theme}`];
    animateImage(heroImage);
  });
});

const previews: Record<string, { alt: string; caption: string }> = {
  "library-dark": {
    alt: "Runlens dark session library with projects, Claude Code and Codex sessions, search, and filters.",
    caption: "One library for your supported agents. Demo sessions shown.",
  },
  "session-dark": {
    alt: "Runlens dark timeline with a failed test, a recorded file patch, and a successful focused test run.",
    caption: "Read the request beside the recorded work. Demo session shown.",
  },
  "library-light": {
    alt: "Runlens light session library with an agent selector, pinned sessions, and project groups.",
    caption: "A workspace for the history you want to keep. Demo sessions shown.",
  },
};
const featureImage = document.querySelector<HTMLImageElement>("#feature-screenshot");
const caption = document.querySelector("#preview-caption");
const previewButtons = document.querySelectorAll<HTMLButtonElement>("[data-preview]");
document.querySelector(".preview-choices")?.removeAttribute("hidden");
function selectPreview(button: HTMLButtonElement) {
  const key = button.dataset.preview;
  if (!key || !previews[key] || !featureImage || button.getAttribute("aria-pressed") === "true")
    return;
  previewButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  featureImage.src = __SITE_IMAGES__[key];
  featureImage.alt = previews[key].alt;
  if (caption) caption.textContent = previews[key].caption;
  animateImage(featureImage);
}
previewButtons.forEach((button) => {
  button.addEventListener("click", () => selectPreview(button));
  button.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") selectPreview(button);
  });
});

const stepButtons = document.querySelectorAll<HTMLButtonElement>("[data-step]");
const panels = document.querySelectorAll<HTMLElement>("[data-panel]");
document.querySelector(".walkthrough-steps")?.removeAttribute("hidden");
function selectStep(button: HTMLButtonElement, animate = true) {
  stepButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== button.dataset.step;
    if (!panel.hidden && animate) enter(panel);
  });
}
if (stepButtons[0]) selectStep(stepButtons[0], false);
stepButtons.forEach((button) => button.addEventListener("click", () => selectStep(button)));

const copyStatus = document.querySelector("#copy-status");
const copyTimers = new WeakMap<HTMLButtonElement, number>();
document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) => {
  button.hidden = false;
  button.addEventListener("click", async () => {
    const code = document.getElementById(button.dataset.copy ?? "");
    if (!code) return;
    const original = 'Copy <span aria-hidden="true">↗</span>';
    try {
      await navigator.clipboard.writeText(code.textContent ?? "");
      window.clearTimeout(copyTimers.get(button));
      button.textContent = "Copied";
      if (copyStatus)
        copyStatus.textContent = "Setup commands copied. Paste them into your terminal.";
      copyTimers.set(
        button,
        window.setTimeout(() => {
          button.innerHTML = original;
        }, 2200),
      );
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (copyStatus)
        copyStatus.textContent = "Select and copy the highlighted command with Ctrl+C or ⌘C.";
    }
  });
});

// One scheduled frame per scroll; no component state or continuous animation loop.
const parallax = document.querySelector<HTMLElement>("[data-parallax]");
let pendingFrame = 0;
function updateParallax() {
  pendingFrame = 0;
  if (!parallax) return;
  if (reducedMotion.matches) {
    parallax.style.transform = "";
    return;
  }
  const bounds = parallax.getBoundingClientRect();
  if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
  const progress = Math.max(0, Math.min(1, 1 - bounds.top / window.innerHeight));
  parallax.style.transform = `translateY(${progress * -8}px)`;
}
window.addEventListener(
  "scroll",
  () => {
    if (!pendingFrame) pendingFrame = window.requestAnimationFrame(updateParallax);
  },
  { passive: true },
);
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) document.getAnimations().forEach((animation) => animation.cancel());
  updateParallax();
});
