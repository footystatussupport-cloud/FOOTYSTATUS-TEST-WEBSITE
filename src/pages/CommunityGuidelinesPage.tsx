import Header from "@/components/Header";
import LegalBackButton from "@/components/LegalBackButton";
import { FOOTY_STATUS_CONTACT_EMAIL, FOOTY_STATUS_CONTACT_MAILTO } from "@/lib/contact";

type SectionContent = {
  paragraphs?: string[];
  lead?: string;
  items?: string[];
  after?: string[];
};

type GuidelineSection = SectionContent & {
  title: string;
};

const sections: GuidelineSection[] = [
  { title: "1. Respect Other Users", paragraphs: ["Treat other members of the Footy Status community with respect."], lead: "Do not:", items: ["Bully", "Harass", "Intimidate", "Threaten", "Humiliate", "Repeatedly target another person", "Encourage others to harass someone", "Create accounts to continue unwanted contact", "Circumvent another user's block"], after: ["Competitive discussion is allowed. Targeted abuse is not."] },
  { title: "2. Protect Children and Minors", paragraphs: ["Footy Status has zero tolerance for child sexual exploitation or abuse."], lead: "Never:", items: ["Sexualize a minor", "Solicit sexual content from a minor", "Send sexual messages to a minor", "Groom a minor", "Attempt to arrange inappropriate sexual contact with a minor", "Share sexual imagery involving minors", "Request sexual imagery involving minors", "Threaten to distribute sexual imagery involving minors", "Facilitate child exploitation or trafficking", "Encourage predatory behavior toward minors"], after: ["Suspected exploitation may result in immediate account termination and preservation or disclosure of information to appropriate authorities where required or permitted by law."] },
  { title: "3. Sexual Content", paragraphs: ["Do not post pornography, explicit sexual content, sexual solicitation, or non-consensual intimate content.", "Sexual content involving minors is strictly prohibited regardless of intent.", "Soccer content that incidentally includes ordinary athletic clothing is not prohibited merely because of clothing typically worn during sport."] },
  { title: "4. Nudity", paragraphs: ["Do not post explicit nudity or sexually explicit imagery.", "Content should remain appropriate for a soccer-focused platform that may be used by minors."] },
  { title: "5. Bullying and Harassment", paragraphs: ["Do not use Footy Status to attack people based on appearance, ability, performance, identity, background, mistakes, or other personal characteristics."], lead: "Prohibited conduct includes:", items: ["Repeated insults", "Targeted humiliation", "Sexual harassment", "Encouraging self-harm", "Coordinated harassment", "Threatening unwanted exposure of private information", "Repeated unwanted contact"], after: ["Criticizing a soccer performance respectfully is different from personally attacking a player."] },
  { title: "6. Hate and Discrimination", paragraphs: ["Content attacking or dehumanizing people based on protected characteristics is prohibited.", "Do not promote hatred, violence, exclusion, or unlawful discrimination against protected groups."] },
  { title: "7. Threats and Violence", paragraphs: ["Do not make credible threats of violence."], lead: "Do not use Footy Status to:", items: ["Threaten physical harm", "Encourage violence", "Coordinate violent activity", "Celebrate serious real-world violence in a manner that encourages further harm", "Intimidate users with threats"], after: ["Soccer footage showing ordinary lawful physical play is permitted."] },
  { title: "8. Dangerous Activity", paragraphs: ["Do not use Footy Status to encourage dangerous behavior likely to cause serious injury.", "Soccer training content is permitted, but users should exercise appropriate judgment and follow qualified coaching and medical advice."] },
  { title: "9. Self-Harm", paragraphs: ["Do not encourage, glorify, instruct, or pressure another person to engage in suicide or self-harm.", "If someone appears to be in immediate danger, contact appropriate emergency services."] },
  { title: "10. Privacy", paragraphs: ["Respect other people's privacy.", "Do not publish another person's sensitive private information without authorization."], lead: "This includes information such as:", items: ["Home addresses", "Passwords", "Financial account information", "Government identification numbers", "Private authentication information", "Other highly sensitive personal information"], after: ["Take particular care with information involving minors."] },
  { title: "11. Impersonation", lead: "Do not deceptively impersonate:", items: ["Players", "Coaches", "Scouts", "Teams", "Clubs", "Schools", "Referees", "Parents", "Footy Status personnel", "Other individuals or organizations"], after: ["Fan, parody, or commentary accounts must not misleadingly present themselves as the actual person or organization."] },
  { title: "12. False Team Relationships", lead: "Do not falsely claim that:", items: ["You play for a team", "You coach a team", "You work for a club", "You represent a school", "You are another user's parent", "A player belongs to your organization", "You are a scout for an organization"], after: ["Fraudulent links may be removed and may result in enforcement."] },
  { title: "13. Scouts and Recruiting", paragraphs: ["Users presenting themselves as scouts must not use Footy Status to exploit players."], lead: "Scouts and recruiters must not:", items: ["Request inappropriate personal information", "Make fraudulent offers", "Demand payment in exchange for fake opportunities", "Misrepresent organizations", "Use recruiting as a pretext for inappropriate communication", "Exploit minors"], after: ["Players and parents should independently verify recruiting opportunities.", "Minors should involve a parent or guardian in recruiting-related communications."] },
  { title: "14. Scams and Fraud", lead: "Do not:", items: ["Run scams", "Steal accounts", "Phish for passwords", "Send fraudulent payment requests", "Promote fake trials", "Promote fake scholarships", "Promote fake contracts", "Sell fraudulent services", "Misrepresent your identity for financial gain", "Manipulate users into sending money"] },
  { title: "15. Spam", paragraphs: ["Do not repeatedly post or send unwanted promotional, repetitive, misleading, or irrelevant content.", "Automated or coordinated spam may result in restrictions or termination."] },
  { title: "16. Next Up Videos", paragraphs: ["Next Up exists for soccer-related highlight content."], lead: "Videos should primarily relate to:", items: ["Matches", "Training", "Skills", "Goals", "Saves", "Assists", "Defensive plays", "Soccer highlights", "Other legitimate soccer activity"], after: ["Do not upload unrelated inappropriate material simply to gain exposure.", "Videos remain subject to all other Community Guidelines."] },
  { title: "17. Misleading Content", paragraphs: ["Do not deliberately manipulate content to falsely portray another user engaging in misconduct.", "Do not intentionally present fabricated statistics, affiliations, achievements, or credentials as authentic."] },
  { title: "18. Comments and Captions", paragraphs: ["Comments, captions, titles, and biographies must follow these Guidelines.", "Do not use text fields to bypass content moderation.", "Attempting to evade profanity or safety filters through intentional misspellings, symbols, spacing, images, or coded language may result in enforcement."] },
  { title: "19. Profanity", paragraphs: ["Footy Status may restrict profanity and inappropriate language.", "Because the platform may include minors, users should keep communication appropriate for a broad soccer community.", "Repeated attempts to bypass language filters may result in restrictions."] },
  { title: "20. Illegal Activity", paragraphs: ["Do not use Footy Status to facilitate, coordinate, promote, or solicit illegal activity.", "Content may be preserved or disclosed where required by valid legal process or applicable law."] },
  { title: "21. Weapons and Serious Threats", paragraphs: ["Content displaying ordinary lawful contexts may be evaluated based on context, but users may not use Footy Status to threaten others, facilitate violent criminal conduct, or promote weapon use for harming people."] },
  { title: "22. Drugs and Controlled Substances", paragraphs: ["Do not use Footy Status to sell, distribute, or facilitate illegal drugs or unlawfully obtained controlled substances."] },
  { title: "23. Intellectual Property", paragraphs: ["Only upload content you have the right to share."], lead: "Do not knowingly upload:", items: ["Stolen videos", "Copyrighted broadcasts without authorization", "Other people's photographs without appropriate rights", "Protected logos or creative works in an infringing manner", "Content copied from another creator in violation of their rights"], after: ["A soccer clip being available online does not automatically give you permission to upload it.", "Copyright concerns may be sent to:"] },
  { title: "24. Account Security", lead: "Do not:", items: ["Attempt to access another user's account", "Request another user's password", "Steal authentication tokens", "Exploit security vulnerabilities", "Circumvent access controls", "Disrupt Footy Status systems"], after: ["If you discover a security problem, report it to:", "Do not exploit the vulnerability."] },
  { title: "25. Platform Manipulation", paragraphs: ["Do not artificially manipulate Footy Status."], lead: "This includes:", items: ["Fake accounts", "Artificial likes", "Automated comments", "Bot engagement", "Manipulating view counts", "Exploiting recommendation systems", "Abusing reporting systems", "Coordinated fake engagement", "Attempting to manipulate Pro status", "Exploiting payment systems"] },
  { title: "26. Reporting Abuse", paragraphs: ["If you encounter content or behavior that violates these Guidelines, use Footy Status's reporting tools where available.", "Reports should be submitted in good faith.", "Do not knowingly file false reports to harass another user or manipulate enforcement."] },
  { title: "27. Blocking Users", paragraphs: ["Users may block other accounts where the feature is available."], lead: "Do not circumvent a block by:", items: ["Creating another account", "Using another person's account", "Asking others to contact the person on your behalf for harassment", "Otherwise attempting to defeat the block"] },
  { title: "28. Enforcement", lead: "Depending on the violation, Footy Status may:", items: ["Remove content", "Reject content", "Limit distribution", "Issue a warning", "Issue a strike", "Disable functionality", "Restrict an account", "Temporarily suspend an account", "Permanently terminate an account", "Remove fraudulent relationships", "Take additional safety measures"], after: ["Footy Status is not required to apply every enforcement measure in a particular order."] },
  { title: "29. Severe Violations", paragraphs: ["Some conduct may result in immediate permanent termination."], lead: "Examples include:", items: ["Child sexual exploitation", "Grooming", "Credible threats of serious violence", "Serious predatory behavior", "Severe harassment", "Human trafficking", "Serious fraud", "Distribution of child sexual abuse material", "Repeated attempts to evade serious enforcement", "Other activity presenting a substantial safety or legal risk"] },
  { title: "30. Repeat Violations", paragraphs: ["Repeated violations may result in progressively stronger enforcement.", "A user who repeatedly violates the Guidelines may be permanently removed even if individual violations would not independently have resulted in permanent termination."] },
  { title: "31. Attempts to Evade Enforcement", paragraphs: ["Do not create or use another account to evade suspension, termination, feature restrictions, blocks, or other enforcement measures.", "Accounts used for enforcement evasion may also be removed."] },
  { title: "32. Moderation Decisions", paragraphs: ["Not every disagreement constitutes a policy violation."], lead: "Footy Status may consider:", items: ["Context", "Severity", "Intent where relevant", "Potential harm", "User history", "Target of the behavior", "Age and safety considerations", "Applicable law", "Other relevant circumstances"] },
  { title: "33. Appeals and Questions", paragraphs: ["If you believe Footy Status made an enforcement decision in error, you may contact:"], after: ["Include your username and enough information for us to identify the relevant enforcement action.", "Do not send passwords or unnecessary sensitive information.", "Submitting an appeal does not guarantee reversal."] },
  { title: "34. Emergency Situations", paragraphs: ["Footy Status's reporting system is not an emergency service.", "If you or another person faces immediate danger, contact local emergency services or appropriate authorities."] },
  { title: "35. Parents and Guardians", paragraphs: ["Parents and guardians should discuss safe online behavior with younger users.", "Parents or guardians with concerns about their child's Footy Status account may contact:"] },
  { title: "36. Changes to These Guidelines", paragraphs: ["Footy Status may update these Community Guidelines as the platform evolves.", "Material changes may be communicated where appropriate or required.", "The latest version will identify its most recent update date."] },
  { title: "37. Our Goal", paragraphs: ["Footy Status is intended to give the soccer community a safe place to showcase talent, celebrate the game, connect with teams and soccer participants, and discover players and content.", "Competition belongs on the pitch.", "Harassment, exploitation, discrimination, scams, predatory behavior, and abuse do not belong on Footy Status.", "Help us keep the platform safe, competitive, respectful, and focused on soccer."] },
  { title: "38. Contact", paragraphs: ["Questions, reports, safety concerns, appeals, copyright concerns, and Community Guidelines questions may be sent to:", "Footy Status"] },
];

const SupportEmail = () => (
  <a className="text-primary underline" href={FOOTY_STATUS_CONTACT_MAILTO}>
    {FOOTY_STATUS_CONTACT_EMAIL}
  </a>
);

const shouldShowEmailAfter = (title: string, text: string) =>
  (title === "23. Intellectual Property" && text === "Copyright concerns may be sent to:") ||
  (title === "24. Account Security" && text === "If you discover a security problem, report it to:");

const CommunityGuidelinesPage = () => (
  <div className="min-h-screen bg-background">
    <div className="mx-auto min-h-screen w-full max-w-md overflow-x-hidden border-x border-border bg-background">
      <Header />
      <main className="px-4 py-6">
        <LegalBackButton />

        <h1 className="text-2xl font-bold">Footy Status Community Guidelines</h1>
        <p className="mt-2 text-sm text-muted-foreground">Effective Date: July 25, 2026</p>
        <p className="text-sm text-muted-foreground">Last Updated: July 25, 2026</p>

        <div className="mt-6 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>Footy Status exists to give the soccer community a place where players can showcase their abilities, teams can build their presence, coaches and staff can connect with their organizations, and the broader soccer community can discover and interact with soccer content.</p>
          <p>These Community Guidelines apply to everyone using Footy Status and to all content and activity on the platform.</p>
          <p>Violating these Guidelines may result in content removal, warnings, strikes, feature restrictions, temporary suspension, or permanent account termination.</p>
          <p>Serious violations may result in immediate removal or termination.</p>
        </div>

        <div className="mt-8">
          {sections.map(({ title, paragraphs, lead, items, after }) => (
            <section className="mb-6" key={title}>
              <h2 className="mb-2 text-lg font-semibold text-navy">{title}</h2>
              <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                {paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {lead && <p>{lead}</p>}
                {items && (
                  <ul className="list-disc space-y-1 pl-5">
                    {items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
                {(title === "33. Appeals and Questions" || title === "35. Parents and Guardians") && <p><SupportEmail /></p>}
                {after?.map((paragraph) => (
                  <div key={paragraph}>
                    <p>{paragraph}</p>
                    {shouldShowEmailAfter(title, paragraph) && <p className="mt-3"><SupportEmail /></p>}
                  </div>
                ))}
                {title === "38. Contact" && <p><SupportEmail /></p>}
              </div>
            </section>
          ))}
          <p className="pt-2 text-xs text-muted-foreground">&copy; 2026 Footy Status. All rights reserved.</p>
        </div>
      </main>
    </div>
  </div>
);

export default CommunityGuidelinesPage;
