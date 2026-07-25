import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Header from "@/components/Header";
import { FOOTY_STATUS_CONTACT_EMAIL, FOOTY_STATUS_CONTACT_MAILTO } from "@/lib/contact";

// Static legal document. Rendered for every account type (and publicly), reached
// from Settings -> Legal -> Terms of Service. The wording below is authoritative;
// update the dates in the header when the terms change.

const SupportEmail = () => (
  <a className="text-primary underline" href={FOOTY_STATUS_CONTACT_MAILTO}>
    {FOOTY_STATUS_CONTACT_EMAIL}
  </a>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-6">
    <h2 className="mb-2 text-lg font-semibold text-navy">{title}</h2>
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
  </section>
);

const List = ({ items }: { items: string[] }) => (
  <ul className="list-disc space-y-1 pl-5">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

const TermsOfServicePage = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto min-h-screen w-full max-w-md overflow-x-hidden border-x border-border bg-background">
        <Header />

        <main className="px-4 py-6">
          <Link
            to="/settings"
            className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Link>

          <h1 className="text-2xl font-bold">Footy Status Terms of Service</h1>
          <p className="mt-2 text-sm text-muted-foreground">Effective Date: July 25, 2026</p>
          <p className="text-sm text-muted-foreground">Last Updated: July 25, 2026</p>

          <div className="mt-6 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) govern access to and use of the Footy
              Status mobile application, website, and related services (collectively, the
              &ldquo;Services&rdquo;).
            </p>
            <p>
              By creating an account, accessing, or using Footy Status, you agree to these Terms.
            </p>
            <p>If you do not agree, do not use the Services.</p>
          </div>

          <div className="mt-8">
            <Section title="1. About Footy Status">
              <p>
                Footy Status is a soccer-focused platform designed to help players, parents and
                guardians, coaches, team staff, teams, clubs, schools, scouts, referees, and other
                soccer-community participants create profiles, share soccer-related content, display
                information and statistics, connect with teams and users, and use other soccer-related
                functionality.
              </p>
              <p>
                Footy Status is not a professional sports governing body, player agent, recruiting
                agency, school, club, league, tournament operator, or employment agency unless
                expressly stated otherwise.
              </p>
            </Section>

            <Section title="2. Eligibility">
              <p>You may use Footy Status only if your use is permitted under applicable law and these Terms.</p>
              <p>
                Minors may be subject to additional age restrictions, parental or guardian involvement,
                consent requirements, or feature limitations.
              </p>
              <p>
                Where parental or guardian consent is legally required, the appropriate parent or
                guardian must provide that consent before the applicable Services are used.
              </p>
              <p>
                Parents and guardians who authorize a child&rsquo;s use of Footy Status are responsible
                for supervising the child&rsquo;s use as required by applicable law.
              </p>
            </Section>

            <Section title="3. Account Registration">
              <p>You agree to provide accurate information when creating and maintaining an account.</p>
              <p>You may not:</p>
              <List
                items={[
                  "Create an account using a false identity for deceptive purposes",
                  "Impersonate another person",
                  "Intentionally misrepresent your team or organizational affiliation",
                  "Create accounts to evade suspension or termination",
                  "Sell or transfer accounts without authorization",
                  "Access another user's account without permission",
                ]}
              />
              <p>
                You are responsible for maintaining the confidentiality of your credentials and for
                activity occurring through your account to the extent permitted by law.
              </p>
              <p>
                Notify us at <SupportEmail /> if you believe your account has been compromised.
              </p>
            </Section>

            <Section title="4. Account Types">
              <p>Footy Status may provide different account types, including:</p>
              <List
                items={[
                  "Player",
                  "Parent or guardian",
                  "Coach",
                  "Team staff",
                  "Team or club",
                  "School team",
                  "Scout",
                  "Referee",
                  "Footy Status administrative accounts",
                  "Other account types introduced in the future",
                ]}
              />
              <p>Features, permissions, visibility, and functionality may vary by account type.</p>
              <p>
                Creating a particular account type does not independently verify that a user actually
                possesses the claimed professional role, credential, affiliation, or authority unless
                Footy Status expressly indicates that verification has occurred.
              </p>
            </Section>

            <Section title="5. Team and User Linking">
              <p>
                Footy Status may allow players, coaches, staff, parents, teams, and other accounts to
                establish relationships.
              </p>
              <p>
                These may include invitations, requests, team codes, parent-child connections, roster
                membership, and staff assignments.
              </p>
              <p>
                Users must not intentionally create fraudulent relationships or falsely claim
                affiliation with another person or organization.
              </p>
              <p>
                Footy Status may remove relationships that are fraudulent, unauthorized, inaccurate,
                abusive, or inconsistent with our policies.
              </p>
            </Section>

            <Section title="6. User Content">
              <p>
                &ldquo;User Content&rdquo; includes content users submit, upload, post, transmit, or
                otherwise make available through Footy Status, including:
              </p>
              <List
                items={[
                  "Photos",
                  "Videos",
                  "Highlight clips",
                  "Captions",
                  "Comments",
                  "Profile information",
                  "Statistics",
                  "Team updates",
                  "News posts",
                  "Biographies",
                  "Other submitted materials",
                ]}
              />
              <p>You retain ownership of rights you have in your User Content.</p>
              <p>
                By submitting User Content to Footy Status, you grant Footy Status a non-exclusive,
                worldwide, royalty-free license to host, store, reproduce, process, display,
                distribute, transmit, format, adapt, and otherwise use that content as reasonably
                necessary to operate, provide, secure, moderate, promote, and improve the Services.
              </p>
              <p>
                This license is limited to purposes connected to operating and providing Footy Status
                and continues for as long as necessary to provide the Services, subject to applicable
                law and our deletion practices.
              </p>
              <p>You represent that you have the rights and permissions necessary to submit your User Content.</p>
            </Section>

            <Section title="7. Content Featuring Other People">
              <p>
                Do not upload content that violates another person&rsquo;s privacy, publicity,
                intellectual-property, or other legal rights.
              </p>
              <p>
                You are responsible for obtaining appropriate authorization before uploading content
                when authorization is legally required.
              </p>
              <p>Special care should be exercised when uploading content featuring minors.</p>
            </Section>

            <Section title="8. Prohibited Content and Conduct">
              <p>You may not use Footy Status to:</p>
              <List
                items={[
                  "Bully or harass others",
                  "Threaten violence",
                  "Promote violence",
                  "Sexually exploit anyone",
                  "Sexualize minors",
                  "Groom minors",
                  "Share child sexual abuse material",
                  "Engage in predatory behavior",
                  "Share non-consensual intimate imagery",
                  "Promote hatred or unlawful discrimination",
                  "Impersonate another person deceptively",
                  "Scam or defraud users",
                  "Spam users",
                  "Distribute malware",
                  "Attempt unauthorized access",
                  "Circumvent security controls",
                  "Manipulate platform systems",
                  "Evade enforcement actions",
                  "Violate another person's privacy",
                  "Infringe copyrights or other intellectual-property rights",
                  "Publish highly sensitive personal information without authorization",
                  "Engage in illegal activity",
                  "Encourage illegal activity",
                  "Use the Services in a manner that creates unreasonable safety risks",
                ]}
              />
              <p>
                Additional requirements appear in the Footy Status Community Guidelines and are
                incorporated into these Terms.
              </p>
            </Section>

            <Section title="9. Content Moderation">
              <p>Footy Status may review content before or after publication.</p>
              <p>
                We may, but are not obligated to, remove, restrict, reject, disable, preserve, or
                review User Content when we believe appropriate to:
              </p>
              <List
                items={[
                  "Enforce these Terms",
                  "Enforce Community Guidelines",
                  "Protect users",
                  "Protect minors",
                  "Investigate reports",
                  "Prevent abuse",
                  "Address illegal content",
                  "Protect Footy Status",
                  "Comply with legal obligations",
                ]}
              />
              <p>
                The existence of moderation does not guarantee that all inappropriate content will be
                identified immediately.
              </p>
            </Section>

            <Section title="10. Reports, Warnings, Strikes, Suspensions, and Termination">
              <p>Users may be able to report accounts or content.</p>
              <p>Footy Status may respond by:</p>
              <List
                items={[
                  "Taking no action",
                  "Removing content",
                  "Restricting content",
                  "Issuing warnings",
                  "Issuing strikes",
                  "Restricting features",
                  "Temporarily suspending accounts",
                  "Permanently terminating accounts",
                  "Taking other reasonable safety measures",
                ]}
              />
              <p>Severe violations may result in immediate termination without prior warnings.</p>
              <p>
                Footy Status may consider severity, context, history, safety risks, and other relevant
                factors when making enforcement decisions.
              </p>
            </Section>

            <Section title="11. Blocking">
              <p>Footy Status may provide functionality allowing users to block other users.</p>
              <p>
                Users must not circumvent another user&rsquo;s block through alternate accounts or
                other means.
              </p>
            </Section>

            <Section title="12. Safety of Minors">
              <p>
                Any exploitation, grooming, sexualization, trafficking, solicitation, or predatory
                targeting of minors is strictly prohibited.
              </p>
              <p>
                Footy Status may immediately suspend or terminate accounts associated with suspected
                child exploitation and may preserve or report relevant information when required or
                permitted by law.
              </p>
              <p>
                Users should report suspected exploitation or immediate safety threats to appropriate
                authorities in addition to using Footy Status reporting tools.
              </p>
            </Section>

            <Section title="13. Statistics and Soccer Information">
              <p>
                Users, teams, coaches, staff, or other participants may submit soccer statistics and
                other performance information.
              </p>
              <p>
                Footy Status does not guarantee that user-submitted statistics, roster information,
                team information, rankings, achievements, affiliations, or other soccer information is
                complete or accurate.
              </p>
              <p>Users should independently verify information where accuracy is important.</p>
            </Section>

            <Section title="14. Recruiting and Scouting">
              <p>
                Footy Status may allow players and scouts or other soccer participants to discover
                profiles and content.
              </p>
              <p>Footy Status does not guarantee:</p>
              <List
                items={[
                  "Recruitment",
                  "Scouting opportunities",
                  "Scholarships",
                  "College admission",
                  "Team selection",
                  "Trials",
                  "Contracts",
                  "Professional opportunities",
                  "Playing time",
                  "Athletic success",
                ]}
              />
              <p>Users are responsible for independently evaluating communications and opportunities.</p>
              <p>
                Minors should involve a parent or guardian when communicating about recruiting, trials,
                travel, contracts, or other significant opportunities.
              </p>
            </Section>

            <Section title="15. Footy Status Pro">
              <p>Footy Status may offer optional paid features under &ldquo;Footy Status Pro.&rdquo;</p>
              <p>Available features, pricing, billing periods, and eligibility will be displayed before purchase.</p>
              <p>
                Footy Status may modify Pro features prospectively, subject to applicable law and
                applicable platform requirements.
              </p>
            </Section>

            <Section title="16. Apple In-App Purchases">
              <p>
                Eligible purchases made through the iOS application are processed through Apple In-App
                Purchase.
              </p>
              <p>Purchases are subject to Apple&rsquo;s applicable payment terms.</p>
              <p>
                Where a purchase is a subscription, information regarding price, billing frequency,
                renewal, and cancellation will be presented through the applicable purchase flow.
              </p>
              <p>Users can manage eligible Apple subscriptions through their Apple account settings.</p>
              <p>Qualifying purchases may be restored through functionality provided by Footy Status and Apple.</p>
              <p>Footy Status does not independently control Apple&rsquo;s payment-processing systems.</p>
            </Section>

            <Section title="17. Refunds">
              <p>
                Purchases processed through Apple are subject to Apple&rsquo;s applicable refund
                procedures and policies.
              </p>
              <p>Nothing in these Terms limits mandatory consumer rights that cannot legally be waived.</p>
            </Section>

            <Section title="18. Intellectual Property">
              <p>
                Except for User Content and third-party materials, Footy Status and its Services&mdash;including
                software, design, branding, logos, interface elements, graphics, text, and other
                proprietary materials&mdash;are owned by or licensed to Footy Status and protected by
                applicable intellectual-property laws.
              </p>
              <p>
                You may not copy, reproduce, modify, distribute, sell, license, reverse engineer, or
                exploit protected Footy Status materials except as permitted by law or with
                authorization.
              </p>
            </Section>

            <Section title="19. Footy Status Name and Branding">
              <p>
                You may not use the Footy Status name, logo, trademarks, or branding in a manner that
                falsely implies sponsorship, endorsement, partnership, or authorization.
              </p>
            </Section>

            <Section title="20. Copyright Complaints">
              <p>If you believe content on Footy Status infringes your copyright, contact:</p>
              <p>
                <SupportEmail />
              </p>
              <p>
                Include sufficient information for us to identify the copyrighted work, locate the
                allegedly infringing material, understand your claim, and contact you.
              </p>
              <p>Knowingly submitting false infringement claims may have legal consequences.</p>
            </Section>

            <Section title="21. Privacy">
              <p>
                Use of Footy Status is also governed by the{" "}
                <Link className="text-primary underline" to="/privacy-policy">
                  Footy Status Privacy Policy
                </Link>
                .
              </p>
            </Section>

            <Section title="22. Account Deletion">
              <p>Users may permanently delete their accounts through available account functionality.</p>
              <p>
                Deletion may result in loss of profile information, videos, relationships, statistics,
                and other account-associated content.
              </p>
              <p>
                Certain records may be retained where permitted or required for security, fraud
                prevention, transactions, dispute resolution, legal compliance, or enforcement.
              </p>
            </Section>

            <Section title="23. Service Changes">
              <p>We may add, modify, discontinue, or replace features.</p>
              <p>We do not guarantee that every feature will remain available permanently.</p>
              <p>
                Where required by law, appropriate notice will be provided for material changes
                affecting users&rsquo; rights.
              </p>
            </Section>

            <Section title="24. Availability">
              <p>We work to maintain reliable Services but do not guarantee uninterrupted availability.</p>
              <p>Footy Status may experience:</p>
              <List
                items={[
                  "Maintenance",
                  "Outages",
                  "Software errors",
                  "Network failures",
                  "Third-party service interruptions",
                  "Data synchronization delays",
                  "Other technical problems",
                ]}
              />
            </Section>

            <Section title="25. Third-Party Services">
              <p>
                Footy Status relies on third-party services, including Supabase and Apple for
                applicable functionality.
              </p>
              <p>
                We are not responsible for independent third-party services outside our reasonable
                control.
              </p>
            </Section>

            <Section title="26. No Medical or Safety Advice">
              <p>Information available through Footy Status is not medical advice.</p>
              <p>
                Players should seek appropriate professional advice concerning injuries, health
                conditions, training safety, or medical decisions.
              </p>
            </Section>

            <Section title="27. No Employment or Agency Relationship">
              <p>
                Use of Footy Status does not create an employment, partnership, joint venture, agency,
                fiduciary, coach-player, agent-athlete, or similar relationship between Footy Status
                and users.
              </p>
            </Section>

            <Section title="28. Disclaimers">
              <p>
                To the fullest extent permitted by applicable law, the Services are provided on an
                &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis.
              </p>
              <p>
                Footy Status does not guarantee that the Services will always be uninterrupted,
                error-free, secure, or free from harmful components, or that user-submitted information
                will always be accurate.
              </p>
              <p>
                Some jurisdictions do not permit certain warranty exclusions, so portions of this
                section may not apply to you.
              </p>
            </Section>

            <Section title="29. Limitation of Liability">
              <p>
                To the fullest extent permitted by applicable law, Footy Status will not be liable for
                indirect, incidental, special, consequential, exemplary, or punitive damages arising
                from or related to use of the Services.
              </p>
              <p>Nothing in these Terms excludes liability that cannot legally be excluded or limited.</p>
            </Section>

            <Section title="30. Indemnification">
              <p>
                To the extent permitted by law, you agree to indemnify and hold harmless Footy Status
                from claims, damages, liabilities, and reasonable expenses arising from your unlawful
                use of the Services, violation of these Terms, violation of another person&rsquo;s
                rights, or User Content you submit.
              </p>
              <p>This provision does not apply where prohibited by applicable law.</p>
            </Section>

            <Section title="31. Termination">
              <p>You may stop using Footy Status at any time.</p>
              <p>
                Footy Status may restrict, suspend, or terminate access when reasonably necessary
                because of:
              </p>
              <List
                items={[
                  "Policy violations",
                  "Safety threats",
                  "Fraud",
                  "Abuse",
                  "Illegal conduct",
                  "Security risks",
                  "Repeated violations",
                  "Attempts to evade enforcement",
                ]}
              />
            </Section>

            <Section title="32. Changes to These Terms">
              <p>We may update these Terms.</p>
              <p>The updated Terms will identify a new &ldquo;Last Updated&rdquo; date.</p>
              <p>
                Where required by law, we will provide additional notice or request agreement to
                material changes.
              </p>
            </Section>

            <Section title="33. Severability">
              <p>
                If any provision of these Terms is found unenforceable, the remaining provisions remain
                effective to the extent permitted by law.
              </p>
            </Section>

            <Section title="34. Entire Agreement">
              <p>
                These Terms, together with the Privacy Policy, Community Guidelines, and any additional
                terms presented for particular features, constitute the agreement governing use of
                Footy Status.
              </p>
            </Section>

            <Section title="35. Contact">
              <p>Questions concerning these Terms may be sent to:</p>
              <p>Footy Status</p>
              <p>
                <SupportEmail />
              </p>
            </Section>

            <p className="pt-2 text-xs text-muted-foreground">
              &copy; 2026 Footy Status. All rights reserved.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
};

export default TermsOfServicePage;
