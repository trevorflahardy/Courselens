export default function AuditPage() {
  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Run audits, view history, and stream live results.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-10">
        <div className="text-center">
          <p className="text-[13px] text-muted-foreground">
            Audit controls and run history will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}
