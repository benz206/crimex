import { CrimeMap } from "@/components/CrimeMap";
import { HomeOverlayNav } from "@/components/HomeOverlayNav";

export default function Home() {
  return (
    <div className="relative h-dvh w-full bg-black">
      <HomeOverlayNav />
      <CrimeMap />
    </div>
  );
}
