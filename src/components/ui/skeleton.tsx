import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton rounded-full bg-foreground/[0.07]", className)}
      {...props}
    />
  );
}

export { Skeleton };
