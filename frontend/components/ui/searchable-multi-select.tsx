"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  label: string;
  meta?: string | null;
}

interface SearchableMultiSelectProps {
  options: SearchableOption[];
  value: string[];
  onValueChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  maxHeightClassName?: string;
}

export function SearchableMultiSelect({
  options,
  value,
  onValueChange,
  placeholder = "Search options...",
  emptyLabel = "No matching results",
  maxHeightClassName = "max-h-64",
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(id);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const needle = query.toLowerCase();
    return options.filter((option) => {
      const inLabel = option.label.toLowerCase().includes(needle);
      const inMeta = option.meta?.toLowerCase().includes(needle) ?? false;
      return inLabel || inMeta;
    });
  }, [query, options]);

  const selectedLabels = useMemo(() => {
    const selectedSet = new Set(value);
    return options.filter((option) => selectedSet.has(option.value)).map((option) => option.label);
  }, [options, value]);

  const toggle = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onValueChange(value.filter((v) => v !== optionValue));
      return;
    }
    onValueChange([...value, optionValue]);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cn(
          "min-h-11 w-full rounded-lg border border-white/16 bg-secondary/45 px-3 py-2 text-left",
          "transition-colors hover:border-white/28 hover:bg-secondary/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {selectedLabels.length === 0 ? (
              <p className="text-sm text-muted-foreground">{placeholder}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {selectedLabels.slice(0, 2).map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-primary/35 bg-primary/16 px-2 py-0.5 text-[11px] text-primary"
                  >
                    {label}
                  </span>
                ))}
                {selectedLabels.length > 2 && (
                  <span className="rounded-full border border-white/20 bg-white/8 px-2 py-0.5 text-[11px] text-muted-foreground">
                    +{selectedLabels.length - 2} more
                  </span>
                )}
              </div>
            )}
          </div>
          <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="absolute z-40 mt-2 w-full rounded-xl border border-white/20 bg-[oklch(0.17_0.02_272/0.96)] p-2 shadow-2xl backdrop-blur-xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full rounded-md border border-white/18 bg-secondary/55 pl-9 pr-8 text-sm text-foreground outline-none transition-colors focus-visible:border-primary/60"
              placeholder="Search assignments..."
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div
            role="listbox"
            aria-multiselectable="true"
            className={cn("mt-2 overflow-y-auto rounded-md border border-white/12 bg-black/18", maxHeightClassName)}
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">{emptyLabel}</p>
            ) : (
              filtered.map((option) => {
                const selected = value.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => toggle(option.value)}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-3 border-b border-white/6 px-3 py-2 text-left",
                      "last:border-b-0 hover:bg-white/9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                      selected && "bg-primary/16",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">{option.label}</span>
                      {option.meta && (
                        <span className="block truncate text-[11px] text-muted-foreground">{option.meta}</span>
                      )}
                    </span>
                    {selected && <Check className="size-4 shrink-0 text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
