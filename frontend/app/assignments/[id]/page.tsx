import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AssignmentDetailPage() {
  return (
    <div className="space-y-6">
      <Card className="glass glow-border">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Assignment Detail</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Full assignment metadata, audit findings by pass, and rubric text will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
