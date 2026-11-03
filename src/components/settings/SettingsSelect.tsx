import { createContext, useContext } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const SettingsPickerContext = createContext<((open: boolean) => void) | undefined>(
  undefined,
);

/** Uses the same picker, keyboard navigation and checkmark treatment as Usage habits. */
export function SettingsSelect({
  id,
  label,
  value,
  options,
  onValueChange,
  disabled,
  invalid,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const onOpenChange = useContext(SettingsPickerContext);
  const selected = options.find((option) => option.value === value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label id={`${id}-label`} htmlFor={id} className="text-xs font-medium">
          {label}
        </label>
      </div>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-invalid={invalid}
            aria-labelledby={`${id}-label ${id}-value`}
            className="flex h-9 w-full items-center justify-between gap-3 rounded-md border border-input bg-background px-3 text-left text-xs transition-colors hover:bg-muted/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              id={`${id}-value`}
              className={cn("truncate", !selected && "text-muted-foreground")}
            >
              {selected?.label ?? placeholder}
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[min(280px,var(--radix-dropdown-menu-content-available-height))] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
        >
          {options.map((option) => (
            <DropdownMenuItem
              key={option.value}
              role="menuitemradio"
              aria-checked={option.value === value}
              disabled={option.disabled}
              onSelect={() => onValueChange(option.value)}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  option.value === value ? "opacity-100" : "opacity-0",
                )}
                aria-hidden="true"
              />
              <span className="truncate">{option.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
