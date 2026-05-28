import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PluginInfo } from "@/types/skills";

interface PluginCardProps {
  plugin: PluginInfo;
  onSelect: () => void;
}

function componentLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function PluginCard({ plugin, onSelect }: PluginCardProps) {
  const nonEmptyComponents = plugin.components.filter((c) => c.count > 0);

  return (
    <Card
      className="group rounded-xl hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
      onClick={onSelect}
      data-selectable
    >
      <CardHeader className="px-4 pt-4 pb-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium leading-tight truncate">
            {plugin.name}
          </span>
          {plugin.version && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
              v{plugin.version}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-2">
        {plugin.description && (
          <p className="text-[13px] text-muted-foreground/80 line-clamp-2 leading-relaxed">
            {plugin.description}
          </p>
        )}
        {nonEmptyComponents.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {nonEmptyComponents
              .map((c) => `${componentLabel(c.type)} ${c.count}`)
              .join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
