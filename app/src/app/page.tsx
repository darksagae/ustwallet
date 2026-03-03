import { Suspense } from "react";
import StakingDashboard from "@/components/StakingDashboard";

export default function Home() {
  return (
    <Suspense>
      <StakingDashboard />
    </Suspense>
  );
}
