"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/**
 * Theme toggle button with a circular clip-path reveal animated via the
 * View Transitions API. The new theme's root snapshot is masked to a
 * growing circle seeded at the button's click coordinates. Falls back to
 * an instant theme swap on browsers that don't support startViewTransition.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const current = (theme === "system" ? resolvedTheme : theme) ?? "dark";

  const toggle = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const next = current === "dark" ? "light" : "dark";

      type DocumentWithViewTransition = Document & {
        startViewTransition?: (cb: () => void) => { ready: Promise<void> };
      };
      const docWithVT = document as DocumentWithViewTransition;

      if (typeof docWithVT.startViewTransition !== "function") {
        setTheme(next);
        return;
      }

      const x = e.clientX;
      const y = e.clientY;
      const maxRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );

      const transition = docWithVT.startViewTransition(() => {
        setTheme(next);
      });

      void transition.ready.then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${maxRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 500,
            easing: "ease-in-out",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      });
    },
    [current, setTheme],
  );

  if (!mounted) {
    return (
      <button
        aria-label="Toggle theme"
        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card/60 text-muted-foreground/70"
      >
        <Sun className="size-3.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${current === "dark" ? "light" : "dark"} mode`}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card/60 text-muted-foreground/80 hover:text-foreground hover:border-primary/50 transition-all"
    >
      {current === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  );
}
