export default function GraphPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dependency Graph</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Interactive force-directed visualization of course item dependencies.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card h-[calc(100vh-13rem)] flex items-center justify-center">
        <p className="text-[13px] text-muted-foreground">
          Graph visualization will render here after ingestion.
        </p>
      </div>
    </div>
  );
}
