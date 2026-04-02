import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const stats = [
  { label: "Total Items", value: "107", icon: "📋", color: "text-foreground" },
  { label: "Gaps", value: "—", icon: "🔴", color: "text-severity-gap" },
  { label: "Warnings", value: "—", icon: "🟡", color: "text-severity-warn" },
  { label: "Clean", value: "—", icon: "🟢", color: "text-severity-ok" },
  { label: "Unaudited", value: "107", icon: "⚪", color: "text-muted-foreground" },
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
    <Badge variant="outline" className={`severity-${severity} border text-xs`}>
      {severity}
    </Badge>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="glass glow-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className={`text-2xl font-bold tracking-tight ${stat.color}`}>
                    {stat.value}
                  </p>
                </div>
                <span className="text-2xl">{stat.icon}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Quick actions */}
        <Card className="glass glow-border">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <button className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-left glass-subtle hover:glass-strong transition-all duration-200 flex items-center gap-3">
              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              Ingest from Canvas
            </button>
            <button className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-left glass-subtle hover:glass-strong transition-all duration-200 flex items-center gap-3">
              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              Run Full Audit
            </button>
            <button className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-left glass-subtle hover:glass-strong transition-all duration-200 flex items-center gap-3">
              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
              </svg>
              View Dependency Graph
            </button>
          </CardContent>
        </Card>

        {/* Recent findings */}
        <Card className="col-span-2 glass glow-border">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Recent Findings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentFindings.map((finding, i) => (
                <div key={i} className="rounded-lg p-4 glass-subtle">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{finding.title}</p>
                      <p className="text-xs text-muted-foreground">{finding.body}</p>
                    </div>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Course info */}
      <Card className="glass glow-border">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Course Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-6 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Course</p>
              <p className="font-medium">EGN 3000L — Foundations of Engineering Lab</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Term</p>
              <p className="font-medium">Spring 2026</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Modules</p>
              <p className="font-medium">21 modules, 107 items</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Canvas ID</p>
              <p className="font-mono font-medium">2018858</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
