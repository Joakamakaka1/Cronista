import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every 30 seconds, so a screen left open moves on by itself: the day
 * ribbon advances and the form gives way to the close at 22:00.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
