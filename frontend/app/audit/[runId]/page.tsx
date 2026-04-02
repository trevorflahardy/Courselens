import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuditRunDetailPage() {
  return (
    <div className="space-y-6">
      <Card className="glass glow-border">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Audit Run Detail</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Per-run progress, SSE live stream, and findings breakdown will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
