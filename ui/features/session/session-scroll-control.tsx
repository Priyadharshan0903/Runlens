import { ArrowLineDownIcon, ArrowLineUpIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "preact/hooks";

/** Keep scroll updates local so moving through a session never rerenders its transcript. */
export function SessionScrollControl() {
  const control = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState<"top" | "bottom" | null>(null);

  useEffect(() => {
    const scroller = control.current?.closest<HTMLElement>(".main");
    const session = control.current?.closest<HTMLElement>(".session");
    if (!scroller || !session) return;
    let frame = 0;

    const updateDirection = () => {
      frame = 0;
      const distance = scroller.scrollHeight - scroller.clientHeight;
      setDirection(distance <= 1 ? null : scroller.scrollTop < distance / 2 ? "bottom" : "top");
    };

    function scheduleUpdate() {
      if (!frame) frame = requestAnimationFrame(updateDirection);
    }

    const resize = new ResizeObserver(scheduleUpdate);
    resize.observe(scroller);
    resize.observe(session);
    scroller.addEventListener("scroll", scheduleUpdate, { passive: true });
    updateDirection();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      scroller.removeEventListener("scroll", scheduleUpdate);
    };
  }, []);

  function jump() {
    const scroller = control.current?.closest<HTMLElement>(".main");
    scroller?.scrollTo({
      top: direction === "top" ? 0 : scroller.scrollHeight,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  return (
    <div class="session-scroll-control" ref={control}>
      {direction && (
        <button class="button secondary" aria-controls="main-content" onClick={jump}>
          {direction === "top" ? (
            <ArrowLineUpIcon size={16} aria-hidden="true" />
          ) : (
            <ArrowLineDownIcon size={16} aria-hidden="true" />
          )}
          Move to {direction}
        </button>
      )}
    </div>
  );
}
