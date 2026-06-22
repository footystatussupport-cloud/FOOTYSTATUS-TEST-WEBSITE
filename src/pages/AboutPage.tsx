import { Link } from "react-router-dom";
import { ArrowLeft, Star, Users, Trophy, Globe } from "lucide-react";
import Header from "@/components/Header";
import logo from "@/assets/footystatus-logo.png";

const AboutPage = () => {
  const stats = [
    { icon: Users, value: "50K+", label: "Players" },
    { icon: Trophy, value: "1,200+", label: "Teams" },
    { icon: Star, value: "10K+", label: "Clips" },
    { icon: Globe, value: "45+", label: "Countries" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="px-4 py-6 max-w-2xl mx-auto">
        <Link 
          to="/other"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Link>
        
        <div className="text-center mb-8">
          <img src={logo} alt="FootyStatus" className="h-24 w-auto mx-auto mb-4" />
          <h1 className="text-2xl font-bold">About FootyStatus</h1>
          <p className="text-muted-foreground mt-2">Connecting football talent worldwide</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-card border border-border rounded-xl p-4 text-center">
              <stat.icon className="h-6 w-6 mx-auto text-primary mb-2" />
              <p className="text-2xl font-bold text-navy">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Mission */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-3">Our Mission</h2>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-muted-foreground leading-relaxed">
              FootyStatus is dedicated to democratizing football talent discovery. We believe every player deserves the opportunity to be seen, regardless of their location or resources. Our platform connects aspiring footballers with coaches, scouts, and teams from around the world.
            </p>
          </div>
        </section>

        {/* Features */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-3">What We Offer</h2>
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <div>
              <h3 className="font-medium">Player Profiles</h3>
              <p className="text-sm text-muted-foreground">Create comprehensive profiles showcasing your skills, stats, and highlight clips.</p>
            </div>
            <div>
              <h3 className="font-medium">Live Match Tracking</h3>
              <p className="text-sm text-muted-foreground">Follow matches in real-time with live scores, goal alerts, and detailed statistics.</p>
            </div>
            <div>
              <h3 className="font-medium">Highlight Clips</h3>
              <p className="text-sm text-muted-foreground">Upload and share your best moments to catch the attention of scouts and coaches.</p>
            </div>
            <div>
              <h3 className="font-medium">Team & Scout Connections</h3>
              <p className="text-sm text-muted-foreground">Connect directly with verified teams, coaches, and scouts looking for talent.</p>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-3">Contact</h2>
          <div className="bg-card border border-border rounded-xl p-4 space-y-2">
            <p className="text-sm"><span className="text-muted-foreground">Email:</span> footystatussupport@gmail.com</p>
            <p className="text-sm"><span className="text-muted-foreground">Support:</span> footystatussupport@gmail.com</p>
            <p className="text-sm"><span className="text-muted-foreground">Press:</span> footystatussupport@gmail.com</p>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center text-muted-foreground">
          <p className="text-sm">Version 1.0.0</p>
          <p className="text-xs mt-1">© 2026 FootyStatus. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
