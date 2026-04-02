"use client";

import { usePathname } from "next/navigation";

const routeTitles: Record<string, string> = {
  "/": "Dashboard",
  "/assignments": "Assignments",
  "/graph": "Dependency Graph",
  "/audit": "Audit",
  "/ingest": "Ingestion",
};

function getBreadcrumb(pathname: string): { title: string; parent?: string } {
  if (pathname in routeTitles) {
    return { title: routeTitles[pathname] };
  }
  if (pathname.startsWith("/assignments/")) {
    return { title: "Assignment Detail", parent: "Assignments" };
  }
  if (pathname.startsWith("/audit/")) {
    return { title: "Live Audit", parent: "Audit" };
  }
  return { title: "Course Audit" };
}

export function TopBar() {
  const pathname = usePathname();
  const { title, parent } = getBreadcrumb(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-glass-border px-6 glass-subtle">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        {parent && (
          <>
            <span className="text-sm text-muted-foreground">{parent}</span>
            <svg className="h-4 w-4 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </>
        )}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-3">
        <button className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground glass-subtle hover:text-foreground transition-colors">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
          </svg>
          Refresh
        </button>
      </div>
    </header>
  );
}
