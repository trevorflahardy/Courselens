import { Badge } from "@/components/ui/badge";

const stats = [
  { label: "Total Items", value: "107", color: "text-foreground", accent: "bg-primary/10 border-primary/20" },
  { label: "Gaps", value: "\u2014", color: "text-severity-gap", accent: "bg-red-500/5 border-red-500/15" },
  { label: "Warnings", value: "\u2014", color: "text-severity-warn", accent: "bg-amber-500/5 border-amber-500/15" },
  { label: "Clean", value: "\u2014", color: "text-severity-ok", accent: "bg-emerald-500/5 border-emerald-500/15" },
  { label: "Unaudited", value: "107", color: "text-muted-foreground", accent: "bg-white/[0.02] border-white/[0.06]" },
];

const recentFindings = [
  {
    title: "Awaiting first audit",
    body: "Ingest course data and run the AI audit to see findings here.",
    severity: "info" as const,
  },
];

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant="outline" className={`severity-${severity} border text-[11px] font-medium`}>
      {severity}
    </Badge>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-8 max-w-6xl">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground/80 mt-1">Course audit status and quick actions.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className={`rounded-xl border ${stat.accent} px-4 py-4 transition-colors`}>
            <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{stat.label}</p>
            <p className={`text-3xl font-bold tracking-tighter mt-1.5 ${stat.color}`}>
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Quick actions */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <div className="px-5 pt-5 pb-2">
            <h3 className="text-sm font-bold">Quick Actions</h3>
          </div>
          <div className="px-3 pb-3 space-y-0.5">
            {[
              { label: "Ingest from Canvas", icon: "M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" },
              { label: "Run Full Audit", icon: "m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" },
              { label: "View Dependency Graph", icon: "M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" },
            ].map((action) => (
              <button key={action.label} className="w-full rounded-lg px-3 py-2.5 text-[13px] font-medium text-left text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-all duration-150 flex items-center gap-3 group">
                <svg className="h-4 w-4 text-primary/70 group-hover:text-primary transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d={action.icon} />
                </svg>
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {/* Recent findings */}
        <div className="col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-sm font-bold">Recent Findings</h3>
          </div>
          <div className="px-5 pb-5">
            <div className="space-y-2">
              {recentFindings.map((finding, i) => (
                <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[13px] font-semibold">{finding.title}</p>
                      <p className="text-[12px] text-muted-foreground/70 leading-relaxed">{finding.body}</p>
                    </div>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Course info */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-bold">Course Info</h3>
        </div>
        <div className="px-5 pb-5">
          <div className="grid grid-cols-4 gap-8">
            {[
              { label: "Course", value: "EGN 3000L — Foundations of Engineering Lab" },
              { label: "Term", value: "Spring 2026" },
              { label: "Modules", value: "21 modules, 107 items" },
              { label: "Canvas ID", value: "2018858", mono: true },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">{item.label}</p>
                <p className={`text-[13px] font-medium mt-1.5 ${item.mono ? "font-mono text-primary/80" : ""}`}>
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
