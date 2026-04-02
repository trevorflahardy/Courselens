import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function IngestPage() {
  return (
    <div className="space-y-6">
      <Card className="glass glow-border">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Ingest</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Canvas data ingestion controls, progress tracking, and sync history will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
