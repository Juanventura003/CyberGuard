import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";
import "./HelpTip.css";

export default function HelpTip({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    above: boolean;
    width: number;
    height: number;
  } | null>(null);
  const close = () => {
    clearTimeout(timer.current);
    setPosition(null);
  };
  const open = () => {
    clearTimeout(timer.current);
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(310, window.innerWidth - 32);
    const above =
      window.innerHeight - rect.bottom < 220 &&
      rect.top > window.innerHeight - rect.bottom;
    const height = Math.max(
      60,
      above ? rect.top - 24 : window.innerHeight - rect.bottom - 24,
    );
    setPosition({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(
        16,
        Math.min(
          rect.left - width / 2 + rect.width / 2,
          window.innerWidth - width - 16,
        ),
      ),
      above,
      width,
      height,
    });
  };
  const scheduleClose = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current) setPosition(null);
    }, 140);
  };
  useEffect(() => {
    if (!position) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !bubble.current?.contains(event.target as Node)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const scroll = () => close();
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", scroll);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", scroll);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [position]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="cg-help">
      <button
        ref={trigger}
        type="button"
        className="cg-help-button"
        aria-label={`About ${label}`}
        aria-describedby={position ? id : undefined}
        aria-expanded={Boolean(position)}
        onPointerEnter={open}
        onPointerLeave={scheduleClose}
        onFocus={open}
        onBlur={close}
        onClick={open}
      >
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      {position &&
        createPortal(
          <div
            ref={bubble}
            id={id}
            role="tooltip"
            className="cg-help-tooltip"
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
              maxHeight: Math.min(260, position.height),
              transform: position.above ? "translateY(-100%)" : undefined,
            }}
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={scheduleClose}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
