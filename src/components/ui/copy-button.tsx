"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface CopyButtonProps extends React.HTMLAttributes<HTMLButtonElement> {
    value: string;
    onCopied?: () => void;
    variant?: "default" | "ghost" | "outline";
    size?: "default" | "sm" | "lg" | "icon";
}

export function CopyButton({
    value,
    onCopied,
    className,
    variant = "ghost",
    size = "icon",
    ...props
}: CopyButtonProps) {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            onCopied?.();
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    return (
        <Button
            variant={variant}
            size={size}
            className={cn("h-8 w-8", className)}
            onClick={handleCopy}
            {...props}
        >
            {copied ? (
                <Check className="h-4 w-4 text-green-500" />
            ) : (
                <Copy className="h-4 w-4" />
            )}
            <span className="sr-only">Copy</span>
        </Button>
    );
}
