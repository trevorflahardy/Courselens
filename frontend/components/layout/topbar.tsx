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
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-white/[0.06] bg-background/80 backdrop-blur-xl px-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5">
        {parent && (
          <>
            <span className="text-[13px] text-muted-foreground/60">{parent}</span>
            <svg className="h-3 w-3 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </>
        )}
        <h2 className="text-[13px] font-semibold">{title}</h2>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[12px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.06] transition-all duration-150">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
          </svg>
          Refresh
        </button>
      </div>
    </header>
  );
}
