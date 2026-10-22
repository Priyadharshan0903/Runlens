// Sample paths once per layout change. Only packet transforms and opacity animate.
export function initializeTracePackets(
  stage: HTMLElement,
  reducedMotion: MediaQueryList,
  { duration = 14000, stagger = 1900, phase = 2300, opacity = 0.7 } = {},
) {
  const paths = stage.querySelectorAll<SVGPathElement>("[data-flow-path]");
  const packets = stage.querySelectorAll<SVGRectElement>("[data-flow-packet]");
  if (
    !paths.length ||
    paths.length !== packets.length ||
    typeof Element.prototype.animate !== "function" ||
    !("IntersectionObserver" in window)
  )
    return;

  function keyframes(path: SVGPathElement) {
    const length = path.getTotalLength();
    return Array.from({ length: 81 }, (_, step) => {
      const point = path.getPointAtLength((length * step) / 80);
      return {
        transform: `translate(${point.x}px, ${point.y}px)`,
        opacity: step === 0 || step === 80 ? 0 : opacity,
      };
    });
  }

  const animations = Array.from(paths, (path, index) => {
    const animation = packets[index].animate(keyframes(path), {
      duration: duration + index * stagger,
      iterations: Infinity,
      easing: "linear",
    });
    animation.pause();
    animation.currentTime = index * phase;
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
  observer.observe(stage);
  document.addEventListener("visibilitychange", synchronizePlayback);
  reducedMotion.addEventListener("change", synchronizePlayback);

  return () => {
    animations.forEach((animation, index) => {
      const effect = animation.effect;
      if (effect instanceof KeyframeEffect) effect.setKeyframes(keyframes(paths[index]));
    });
  };
}
