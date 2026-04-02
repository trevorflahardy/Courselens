import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AssignmentsPage() {
  return (
    <div className="space-y-6">
      <Card className="glass glow-border">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Assignment list will appear here after ingestion. Filterable by type, severity, week, and search.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
