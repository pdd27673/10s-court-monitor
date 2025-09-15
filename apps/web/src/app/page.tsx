import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Sparkles, Zap, Star, ArrowRight } from "lucide-react";
import { BackgroundBeams } from "@/components/ui/background-beams";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { HoverEffect } from "@/components/ui/card-hover-effect";
import { RedirectToDashboard } from "@/components/redirect-to-dashboard";

const featureItems = [
  {
    title: "Set Preferences",
    description: "Choose your preferred venues, days, times, and price limits with our intuitive interface",
    link: "#",
  },
  {
    title: "Monitor Courts", 
    description: "We check court availability every 10 minutes automatically using advanced monitoring",
    link: "#",
  },
  {
    title: "Get Notified",
    description: "Receive instant email and SMS alerts when courts become available at your preferred times",
    link: "#", 
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <SignedOut>
        <div className="relative h-screen w-full overflow-hidden bg-black -mx-4 sm:-mx-6 lg:-mx-8">
          {/* Single Background Effect */}
          <BackgroundBeams className="absolute inset-0 z-0" />

          {/* Main Content */}
          <div className="relative z-20 w-full">
            <div className="mx-auto max-w-6xl px-4 py-16">
              <div className="flex flex-col items-center justify-center min-h-[90vh] text-center space-y-16">
              
              {/* Hero Section */}
              <div className="space-y-8 max-w-5xl">
                <div className="inline-flex items-center px-6 py-3 bg-white/10 backdrop-blur-sm rounded-full border border-white/20">
                  <Sparkles className="h-5 w-5 text-primary mr-2" />
                  <span className="text-sm font-medium text-white/90">
                    Smart Tennis Court Monitoring
                  </span>
                </div>
                
                <div className="space-y-6">
                  <TextGenerateEffect 
                    words="10s Court Monitor"
                    className="text-7xl md:text-8xl font-bold text-white leading-tight tracking-tight"
                  />
                  <p className="text-2xl text-white/80 max-w-4xl leading-relaxed mx-auto">
                    Never miss a tennis court booking again. Get instant notifications when your preferred courts become available.
                  </p>
                </div>

                <div className="flex items-center justify-center space-x-2 text-yellow-400">
                  <Star className="h-6 w-6 fill-current" />
                  <Star className="h-6 w-6 fill-current" />
                  <Star className="h-6 w-6 fill-current" />
                  <Star className="h-6 w-6 fill-current" />
                  <Star className="h-6 w-6 fill-current" />
                  <span className="text-white/70 ml-2 text-lg">Trusted by tennis enthusiasts worldwide</span>
                </div>

                {/* CTA Button */}
                <div className="pt-8">
                  <SignInButton>
                    <Button 
                      size="lg" 
                      className="bg-white text-black hover:bg-white/90 px-8 py-4 text-lg font-semibold rounded-full border-2 border-white/20 shadow-xl"
                    >
                      Get Started Free
                      <ArrowRight className="h-5 w-5 ml-2" />
                    </Button>
                  </SignInButton>
                </div>
              </div>

              {/* Feature Cards using Aceternity's HoverEffect */}
              <div className="w-full max-w-5xl mx-auto">
                <HoverEffect items={featureItems} />
              </div>

              {/* Bottom CTA */}
              <div className="space-y-6 pt-8">
                <div className="flex items-center justify-center space-x-3">
                  <Zap className="h-6 w-6 text-yellow-400" />
                  <span className="text-xl font-medium text-white">
                    Join thousands of satisfied users
                  </span>
                  <Zap className="h-6 w-6 text-yellow-400" />
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        <RedirectToDashboard />
      </SignedIn>
    </div>
  );
}
