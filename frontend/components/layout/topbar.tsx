"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useAuditStore } from "@/lib/store";
import { ThemeToggle } from "@/components/theme-toggle";

const routeTitles: Record<string, string> = {
  "/": "Dashboard",
  "/assignments": "Assignments",
  "/graph": "Dependency Graph",
  "/audit": "Audit",
  "/ingest": "Ingestion",
  "/changelog": "Changelog",
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

function CourseSelector() {
  const { selectedCourseId, setSelectedCourse } = useAuditStore();
  const [courses, setCourses] = useState<{ id: string; name: string; course_code: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    api.listCourses()
      .then(setCourses)
      .catch(() => setUnconfigured(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (unconfigured) {
    return (
      <span className="text-[11px] text-muted-foreground/40 px-2">Canvas not configured</span>
    );
  }

  return (
    <select
      value={selectedCourseId ?? ""}
      onChange={(e) => {
        const course = courses.find((c) => c.id === e.target.value);
        if (course) setSelectedCourse(course.id, course.name);
      }}
      className="rounded-lg border border-[oklch(0.78_0.022_275_/_0.7)] dark:border-[oklch(0.35_0.03_270_/_0.3)] bg-[oklch(0.97_0.005_275_/_0.8)] dark:bg-[oklch(0.18_0.015_270_/_0.4)] px-2.5 py-1 text-[12px] text-muted-foreground/70 hover:text-foreground transition-all duration-200 cursor-pointer focus:outline-none"
    >
      <option value="" disabled>Select a course...</option>
      {courses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.course_code ? `${c.course_code} — ` : ""}{c.name}
        </option>
      ))}
    </select>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { title, parent } = getBreadcrumb(pathname);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-[oklch(0.82_0.02_275_/_0.5)] dark:border-[oklch(0.35_0.03_270_/_0.2)] bg-[oklch(0.99_0.005_275_/_0.75)] dark:bg-[oklch(0.13_0.02_280_/_0.6)] backdrop-blur-xl px-8 shadow-[0_1px_3px_oklch(0_0_0_/_0.06)] dark:shadow-none">
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
        {mounted ? <CourseSelector /> : null}
        {mounted ? <ThemeToggle /> : null}
        {mounted ? (
          <button className="flex items-center gap-1.5 rounded-lg border border-[oklch(0.78_0.022_275_/_0.7)] dark:border-[oklch(0.35_0.03_270_/_0.3)] bg-[oklch(0.97_0.005_275_/_0.8)] dark:bg-[oklch(0.18_0.015_270_/_0.4)] px-2.5 py-1 text-[12px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-[oklch(0.93_0.01_275_/_0.9)] dark:hover:bg-[oklch(0.22_0.02_270_/_0.5)] hover:border-[oklch(0.6_0.04_270_/_0.5)] dark:hover:border-[oklch(0.45_0.06_270_/_0.3)] transition-all duration-200">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
            </svg>
            Refresh
          </button>
        ) : null}
      </div>
    </header>
  );
}
