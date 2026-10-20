import { useEffect, useState } from "react";
/** Refresh time-based labels independently of network responses or unrelated renders. */
export function useOrganizationClock(interval = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(() => {
      if (!document.hidden) update();
    }, interval);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [interval]);
  return now;
}
