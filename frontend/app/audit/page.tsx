import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <Card className="glass glow-border">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Audit Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Audit controls, run history, and live audit stream will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
