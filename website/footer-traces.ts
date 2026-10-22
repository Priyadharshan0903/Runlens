// A decorative run trace. Only the small packets move; the text and paths stay crisp.
export function initializeFooterTraces(reducedMotion: MediaQueryList) {
  const signature = document.querySelector<HTMLElement>(".footer-signature");
  const paths = signature?.querySelectorAll<SVGPathElement>("[data-flow-path]");
  const packets = signature?.querySelectorAll<SVGRectElement>("[data-flow-packet]");
  if (
    !signature ||
    !paths?.length ||
    !packets ||
    typeof Element.prototype.animate !== "function" ||
    !("IntersectionObserver" in window)
  )
    return;

  const animations = Array.from(paths, (path, index) => {
    const length = path.getTotalLength();
    const frames = Array.from({ length: 81 }, (_, step) => {
      const point = path.getPointAtLength((length * step) / 80);
      return {
        transform: `translate(${point.x}px, ${point.y}px)`,
        opacity: step === 0 || step === 80 ? 0 : 0.7,
      };
    });
    const animation = packets[index].animate(frames, {
      duration: 14000 + index * 1900,
      iterations: Infinity,
      easing: "linear",
    });
    animation.pause();
    animation.currentTime = index * 2300;
    return animation;
  });

  let visible = false;
  function synchronizePlayback() {
    if (reducedMotion.matches) {
      animations.forEach((animation) => animation.cancel());
      return;
    }
    const play = visible && !document.hidden && !reducedMotion.matches;
    animations.forEach((animation) => (play ? animation.play() : animation.pause()));
  }
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    synchronizePlayback();
  });
  observer.observe(signature);
  document.addEventListener("visibilitychange", synchronizePlayback);
  reducedMotion.addEventListener("change", synchronizePlayback);
}
