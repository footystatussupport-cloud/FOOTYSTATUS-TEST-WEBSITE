import { Link } from "react-router-dom";
import { ArrowLeft, HelpCircle, MessageCircle, FileText, Mail, ExternalLink, ChevronRight } from "lucide-react";
import Header from "@/components/Header";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const SupportPage = () => {
  const faqs = [
    {
      question: "How do I create a player profile?",
      answer: "Sign up and select 'Player' as your account type. Fill in your personal information including position, height, weight, and contact details. Your profile will be visible to coaches and scouts."
    },
    {
      question: "Can coaches and scouts see my contact information?",
      answer: "Yes, your phone number and email are visible to verified coaches, scouts, and team staff. Other players cannot see this information to protect your privacy."
    },
    {
      question: "How do I upload highlight clips?",
      answer: "Go to your profile and tap the 'Add Clip' button. You can upload videos directly from your device. Add a title and description to help scouts find your best moments."
    },
    {
      question: "How do I follow matches and get live updates?",
      answer: "Go to the Matches tab to see live and recent matches. Enable push notifications in Settings to receive goal alerts and match updates in real-time."
    },
    {
      question: "How can I verify my team or club account?",
      answer: "Team accounts can request verification by providing official documentation. Contact our support team with proof of your role within the organization."
    },
    {
      question: "Is my data secure?",
      answer: "Yes, we use industry-standard encryption to protect your data. Your contact information is only shared with verified staff members as per our privacy policy."
    },
  ];

  const supportLinks = [
    { icon: MessageCircle, label: "Live Chat", description: "Chat with our support team", action: "Start Chat" },
    { icon: Mail, label: "Email Support", description: "footystatussupport@gmail.com", action: "Send Email" },
    { icon: FileText, label: "Documentation", description: "Read our help guides", action: "View Docs" },
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
        
        <h1 className="text-2xl font-bold mb-6">Help & Support</h1>

        {/* Support Links */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-2">Contact Us</h2>
          <div className="space-y-2">
            {supportLinks.map((link) => (
              <button 
                key={link.label}
                className="flex items-center justify-between w-full p-4 bg-card border border-border rounded-xl hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <link.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">{link.label}</p>
                    <p className="text-sm text-muted-foreground">{link.description}</p>
                  </div>
                </div>
                <span className="text-sm text-primary font-medium flex items-center gap-1">
                  {link.action}
                  <ExternalLink className="h-4 w-4" />
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* FAQ Section */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-2">Frequently Asked Questions</h2>
          <div className="bg-card border border-border rounded-xl">
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((faq, index) => (
                <AccordionItem key={index} value={`item-${index}`} className="border-b last:border-b-0">
                  <AccordionTrigger className="px-4 text-left hover:no-underline hover:bg-muted/50">
                    <span className="font-medium pr-4">{faq.question}</span>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 text-muted-foreground">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* Quick Links */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-navy mb-2">Quick Links</h2>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            <Link to="/privacy-policy" className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
              <span>Privacy Policy</span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </Link>
            <Link to="/terms" className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
              <span>Terms of Service</span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </Link>
            <Link to="/community-guidelines" className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
              <span>Community Guidelines</span>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </Link>
          </div>
        </section>

        {/* App Info */}
        <section className="mb-8">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">FootyStatus v1.0.0</p>
            <p className="text-xs mt-1">© 2026 FootyStatus. All rights reserved.</p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SupportPage;
