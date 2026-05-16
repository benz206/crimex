import { HomeOverlayNav } from "@/components/HomeOverlayNav";
import { CrimeMap } from "@/components/CrimeMapClient";

export default function Home() {
  return (
    <div className="relative h-dvh w-full bg-black">
      <HomeOverlayNav />
      <CrimeMap />
    </div>
  );
}
