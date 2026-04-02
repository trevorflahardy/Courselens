export default function AssignmentDetailPage() {
  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Assignment Detail</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Full metadata, audit findings by pass, and rubric text.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-10">
        <div className="text-center">
          <p className="text-[13px] text-muted-foreground">
            Assignment details and findings will appear here after ingestion.
          </p>
        </div>
      </div>
    </div>
  );
}
