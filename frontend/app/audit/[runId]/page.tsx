export default function AuditRunDetailPage() {
  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit Run Detail</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Per-run progress, live stream, and findings breakdown.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-10">
        <div className="text-center">
          <p className="text-[13px] text-muted-foreground">
            Run progress and findings will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
