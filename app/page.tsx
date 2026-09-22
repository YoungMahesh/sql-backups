"use client";

import { authClient } from "@/lib/auth-client";
import { LandingNav } from "@/components/landing/landing-nav";
import { HeroSection } from "@/components/landing/hero-section";
import { EnginesSection } from "@/components/landing/engines-section";
import { CapabilitiesSection } from "@/components/landing/capabilities-section";
import { ArchitectureSection } from "@/components/landing/architecture-section";
import { CtaBanner } from "@/components/landing/cta-banner";
import { LandingFooter } from "@/components/landing/landing-footer";

export default function HomePage() {
  const { data: session, isPending: isSessionLoading } = authClient.useSession();

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col selection:bg-primary/20 selection:text-ink">
      {/* 1. Top Navigation */}
      <LandingNav
        sessionUser={session?.user}
        isSessionLoading={isSessionLoading}
      />

      {/* Main Editorial Content Stream */}
      <main className="flex-1">
        {/* 2. Hero Band with Interactive Developer Chrome */}
        <HeroSection sessionUser={session?.user} />

        {/* 3. Target Database Engine Matrix */}
        <EnginesSection sessionUser={session?.user} />

        {/* 4. Core Capabilities Grid */}
        <CapabilitiesSection />

        {/* 5. Architecture & Security Deep Dive (High-Contrast Navy) */}
        <ArchitectureSection />

        {/* 6. Coral Callout Banner */}
        <CtaBanner sessionUser={session?.user} />
      </main>

      {/* 7. Dark Navy Editorial Footer */}
      <LandingFooter />
    </div>
  );
}
