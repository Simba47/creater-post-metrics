import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <EmptyState title="Page not found">
      <Link href="/" className="underline underline-offset-4">
        Back to fetching metrics
      </Link>
    </EmptyState>
  );
}
