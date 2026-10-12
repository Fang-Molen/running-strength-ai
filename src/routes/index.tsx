import { createFileRoute } from "@tanstack/react-router";
import { StrengthApp } from "@/components/strength-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <StrengthApp />;
}
