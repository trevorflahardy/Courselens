"use client";

/**
 * Unified-diff renderer. Accepts a diff_patch string (or a crude
 * synthetic diff built from original/new text) and colors each line.
 */

const MAX_LINE_LENGTH = 120;

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) return line;
  return line.slice(0, MAX_LINE_LENGTH) + "…";
}

export function DiffView({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <pre className="rounded-lg bg-card/60 border border-border text-[11px] leading-5 overflow-x-auto p-3 font-mono whitespace-pre">
      {lines.map((line, i) => {
        const cls =
          line.startsWith("+") && !line.startsWith("+++")
            ? "text-emerald-400 bg-emerald-950/40 dark:bg-emerald-950/40 block"
            : line.startsWith("-") && !line.startsWith("---")
              ? "text-red-400 bg-red-950/40 dark:bg-red-950/40 block"
              : line.startsWith("@@")
                ? "text-sky-400 block"
                : "text-muted-foreground/70 block";
        return (
          <span key={i} className={cls}>
            {truncateLine(line) || " "}
          </span>
        );
      })}
    </pre>
  );
}
