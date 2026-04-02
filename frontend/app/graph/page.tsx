import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function GraphPage() {
  return (
    <div className="space-y-6">
      <Card className="glass glow-border h-[calc(100vh-12rem)]">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Dependency Graph</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-full">
          <p className="text-sm text-muted-foreground">
            Interactive force-directed graph visualization will render here after ingestion and graph derivation.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
