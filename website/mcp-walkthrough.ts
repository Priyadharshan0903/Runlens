/** Replay a synthetic MCP example without connecting to a server or reading local history. */
export function initializeMcpWalkthrough(reducedMotion: MediaQueryList) {
  const walkthrough = document.querySelector<HTMLElement>("#mcp-walkthrough");
  if (!walkthrough) return;

  const buttons = Array.from(walkthrough.querySelectorAll<HTMLButtonElement>("[data-mcp-step]"));
  const panels = walkthrough.querySelectorAll<HTMLElement>("[data-mcp-panel]");
  const next = walkthrough.querySelector<HTMLButtonElement>(".mcp-demo-next");
  const nextLabels = ["Next: read the session", "Next: verify today’s code", "Replay walkthrough"];
  let selected = 0;

  function selectStep(index: number, animate = true) {
    selected = index;
    buttons.forEach((button, position) => {
      button.setAttribute("aria-pressed", String(position === index));
    });
    panels.forEach((panel) => {
      panel.getAnimations().forEach((animation) => animation.cancel());
      panel.hidden = panel.dataset.mcpPanel !== buttons[index].dataset.mcpStep;
      if (!panel.hidden && animate && !reducedMotion.matches && typeof panel.animate === "function")
        panel.animate(
          [
            { opacity: 0.5, transform: "translateY(10px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 300, easing: "ease-out" },
        );
    });
    if (next) next.textContent = `${nextLabels[index]} →`;
  }

  if (buttons.length !== panels.length || !buttons.length) return;
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => selectStep(index));
  });
  next?.addEventListener("click", () => selectStep((selected + 1) % buttons.length));
  selectStep(0, false);
  walkthrough.querySelector(".mcp-demo-steps")?.removeAttribute("hidden");
  walkthrough.querySelector(".mcp-demo-content")?.setAttribute("data-enhanced", "");
  next?.removeAttribute("hidden");
}
