import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[2px] text-[13px] font-normal transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-blue-600",
        liquid:
          "liquid-glass-button border border-white/40 text-slate-950 dark:border-white/25 dark:text-white",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/85",
        outline:
          "border border-border-default bg-background text-foreground hover:border-primary hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        mcp: "bg-primary text-primary-foreground hover:bg-blue-600",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 rounded-[2px] px-2.5 text-xs",
        lg: "h-9 rounded-[2px] px-4",
        icon: "h-8 w-8 p-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      onPointerMove,
      onPointerLeave,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    const updateLiquidHighlight: React.PointerEventHandler<
      HTMLButtonElement
    > = (event) => {
      if (variant === "liquid") {
        const element = event.currentTarget;
        const bounds = element.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / bounds.width) * 100;
        const y = ((event.clientY - bounds.top) / bounds.height) * 100;

        element.style.setProperty("--liquid-x", `${x.toFixed(1)}%`);
        element.style.setProperty("--liquid-y", `${y.toFixed(1)}%`);
      }

      onPointerMove?.(event);
    };

    const resetLiquidHighlight: React.PointerEventHandler<HTMLButtonElement> = (
      event,
    ) => {
      if (variant === "liquid") {
        const element = event.currentTarget;
        element.style.removeProperty("--liquid-x");
        element.style.removeProperty("--liquid-y");
      }

      onPointerLeave?.(event);
    };

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        onPointerMove={updateLiquidHighlight}
        onPointerLeave={resetLiquidHighlight}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
