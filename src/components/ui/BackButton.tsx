import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  onClick: () => void;
  title?: string;
}

export function BackButton({ onClick, title }: BackButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors shrink-0"
    >
      <ArrowLeft className="h-4 w-4" />
    </button>
  );
}
