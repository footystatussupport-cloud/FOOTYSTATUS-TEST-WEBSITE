import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Header from "@/components/Header";
import { FOOTY_STATUS_CONTACT_EMAIL, FOOTY_STATUS_CONTACT_MAILTO } from "@/lib/contact";

// Static legal document. Rendered for every account type (and publicly), reached
// from Settings -> Legal -> Privacy Policy. The wording below is authoritative;
// update the dates in the header when the policy text changes.

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

const SubHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="pt-1 text-base font-semibold text-foreground">{children}</h3>
);

const List = ({ items }: { items: string[] }) => (
  <ul className="list-disc space-y-1 pl-5">
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);

const PrivacyPolicyPage = () => {
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

          <h1 className="text-2xl font-bold">Footy Status Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Effective Date: July 25, 2026</p>
          <p className="text-sm text-muted-foreground">Last Updated: July 25, 2026</p>

          <div className="mt-6 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Footy Status (&ldquo;Footy Status,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
              &ldquo;our&rdquo;) respects the privacy of the people who use our services. This
              Privacy Policy describes how we collect, use, disclose, store, protect, and otherwise
              process information when you access or use the Footy Status mobile application, website,
              and related products, features, and services (collectively, the &ldquo;Services&rdquo;).
            </p>
            <p>
              Footy Status is a soccer-focused platform that may be used by players, parents and
              guardians, coaches, team staff, clubs, schools, scouts, referees, and other members of
              the soccer community.
            </p>
            <p>
              By accessing or using the Services, you acknowledge the practices described in this
              Privacy Policy.
            </p>
          </div>

          <div className="mt-8">
            <Section title="1. Information We Collect">
              <p>
                The information we collect depends on how you use Footy Status, your account type,
                your age, the features you use, and the information you choose to provide.
              </p>

              <SubHeading>1.1 Account Information</SubHeading>
              <p>When you create or maintain an account, we may collect:</p>
              <List
                items={[
                  "Name",
                  "Username",
                  "Email address",
                  "Date of birth or age",
                  "Account type",
                  "Authentication information",
                  "Profile photograph",
                  "Biography",
                  "Contact information",
                  "Account preferences",
                  "Information necessary to create, secure, and administer your account",
                ]}
              />
              <p>
                Passwords and authentication credentials may be processed using our authentication
                infrastructure and are not intended to be publicly displayed.
              </p>

              <SubHeading>1.2 Soccer and Profile Information</SubHeading>
              <p>Depending on account type, users may provide information such as:</p>
              <List
                items={[
                  "Playing position",
                  "Preferred position",
                  "Team affiliation",
                  "Club affiliation",
                  "School affiliation",
                  "League",
                  "Age group",
                  "Player statistics",
                  "Match statistics",
                  "Saves and other performance information",
                  "Coaching role",
                  "Coaching experience",
                  "Staff role",
                  "Scouting information",
                  "Team information",
                  "Home field",
                  "Jersey information",
                  "Soccer achievements",
                  "Soccer experience",
                  "Other soccer-related profile information",
                ]}
              />

              <SubHeading>1.3 Photos, Videos, and User-Generated Content</SubHeading>
              <p>Users may submit content including:</p>
              <List
                items={[
                  "Profile pictures",
                  "Highlight videos",
                  "Next Up clips",
                  "Video titles",
                  "Video captions",
                  "Comments",
                  "Likes",
                  "Team updates",
                  "News posts",
                  "Reports",
                  "Other information or content voluntarily submitted through the Services",
                ]}
              />
              <p>
                Content submitted to areas intended to be visible to other users may be displayed to
                those users in accordance with the functionality and visibility rules of Footy Status.
              </p>

              <SubHeading>1.4 Team and Account Relationships</SubHeading>
              <p>
                We may process information concerning relationships established through Footy Status,
                including:
              </p>
              <List
                items={[
                  "Player-to-team relationships",
                  "Coach-to-team relationships",
                  "Staff-to-team relationships",
                  "Parent-to-child relationships",
                  "Mother-team and daughter-team relationships",
                  "Team rosters",
                  "Invitations",
                  "Requests to join",
                  "Acceptance or rejection of invitations",
                  "Other platform relationships",
                ]}
              />
              <p>
                We use this information to provide linking, roster, profile, notification, and
                team-management functionality.
              </p>

              <SubHeading>1.5 Parent and Guardian Information</SubHeading>
              <p>Certain younger users may use Footy Status in connection with a parent or guardian.</p>
              <p>We may collect:</p>
              <List
                items={[
                  "Parent or guardian name",
                  "Parent or guardian contact information",
                  "Parent account information",
                  "Parent-child relationship information",
                  "Information necessary to provide parental functionality",
                  "Information related to consent or authorization where applicable",
                ]}
              />

              <SubHeading>1.6 Device and Technical Information</SubHeading>
              <p>
                We may automatically process limited technical information when the Services are used,
                including:
              </p>
              <List
                items={[
                  "Device type",
                  "Operating system",
                  "App version",
                  "IP address",
                  "Device or application identifiers",
                  "Login information",
                  "Security events",
                  "Diagnostic information",
                  "Error information",
                  "Technical activity necessary to operate and secure the Services",
                ]}
              />

              <SubHeading>1.7 Location-Related Information</SubHeading>
              <p>
                Footy Status may process location-related information associated with users, teams,
                fields, clubs, schools, matches, or other soccer-related activities.
              </p>
              <p>
                This may include information voluntarily entered by users, such as a city, state,
                region, team location, or home field.
              </p>
              <p>
                If Footy Status uses precise device location for a feature, we will request device
                permission when required.
              </p>

              <SubHeading>1.8 Communications</SubHeading>
              <p>If you contact us, we may collect:</p>
              <List
                items={[
                  "Your email address",
                  "Your name or username",
                  "The contents of your communication",
                  "Account information",
                  "Screenshots",
                  "Attachments",
                  "Technical information you provide",
                  "Other information necessary to investigate or respond to your request",
                ]}
              />

              <SubHeading>1.9 Reports and Safety Information</SubHeading>
              <p>
                If you report content or another user, or if another user reports your account or
                content, we may collect and maintain information concerning:
              </p>
              <List
                items={[
                  "The report",
                  "Reported content",
                  "Reporting user",
                  "Reported user",
                  "Reason for the report",
                  "Relevant communications or evidence",
                  "Moderation decisions",
                  "Warnings or strikes",
                  "Suspensions",
                  "Account restrictions",
                  "Appeals",
                  "Other safety actions",
                ]}
              />
            </Section>

            <Section title="2. How We Use Information">
              <p>We may use information to:</p>
              <List
                items={[
                  "Create and maintain accounts",
                  "Authenticate users",
                  "Provide profiles",
                  "Operate Footy Status",
                  "Provide player, team, coach, parent, scout, referee, and staff functionality",
                  "Create and maintain team relationships",
                  "Maintain rosters",
                  "Process team invitations and requests",
                  "Display statistics",
                  "Operate Next Up",
                  "Display user-generated content",
                  "Provide likes and comments",
                  "Provide notifications",
                  "Process reports",
                  "Moderate content",
                  "Protect minors",
                  "Detect inappropriate behavior",
                  "Prevent fraud and abuse",
                  "Investigate violations",
                  "Enforce our Terms of Service and Community Guidelines",
                  "Provide customer support",
                  "Diagnose technical problems",
                  "Maintain security",
                  "Improve reliability and functionality",
                  "Provide Footy Status Pro",
                  "Verify Apple In-App Purchase entitlements",
                  "Restore qualifying purchases",
                  "Maintain transaction records",
                  "Comply with applicable law",
                  "Protect the rights, property, and safety of Footy Status, our users, and others",
                ]}
              />
            </Section>

            <Section title="3. How Information May Be Visible to Other Users">
              <p>
                Footy Status is a social and soccer-networking service. Certain information users
                submit is intended to be visible to other eligible users.
              </p>
              <p>
                Depending on account type, age, permissions, relationships, gender-based visibility
                rules, and functionality, other users may be able to view information such as:
              </p>
              <List
                items={[
                  "Name",
                  "Username",
                  "Profile picture",
                  "Biography",
                  "Soccer position",
                  "Team",
                  "Club",
                  "School",
                  "Soccer statistics",
                  "Highlight videos",
                  "Captions",
                  "Comments",
                  "Likes",
                  "Coaching affiliations",
                  "Staff affiliations",
                  "Other soccer-related information",
                ]}
              />
              <p>
                Users should not publish home addresses, passwords, financial information, government
                identification numbers, or other highly sensitive information in public or
                user-visible areas.
              </p>
            </Section>

            <Section title="4. Service Providers">
              <SubHeading>Supabase</SubHeading>
              <p>Footy Status currently uses Supabase to provide backend infrastructure.</p>
              <p>Supabase may process information on our behalf for purposes including:</p>
              <List
                items={[
                  "Authentication",
                  "Database services",
                  "Account storage",
                  "Application data",
                  "Media storage",
                  "User-generated content storage",
                  "Backend functionality",
                  "Security",
                  "Technical operations",
                ]}
              />
              <p>
                Supabase processes information according to its applicable contractual terms and
                privacy practices.
              </p>
            </Section>

            <Section title="5. Apple In-App Purchases">
              <p>
                Eligible digital purchases made through the iOS application are processed using Apple
                In-App Purchase.
              </p>
              <p>
                Apple processes payment credentials according to Apple&rsquo;s own terms and privacy
                practices.
              </p>
              <p>
                Footy Status does not receive complete credit or debit card information from Apple.
              </p>
              <p>We may receive transaction-related information necessary to:</p>
              <List
                items={[
                  "Verify purchases",
                  "Determine Footy Status Pro entitlement",
                  "Activate purchased features",
                  "Restore qualifying purchases",
                  "Determine subscription status where applicable",
                  "Prevent fraud",
                  "Resolve purchase-related support issues",
                ]}
              />
            </Section>

            <Section title="6. Selling Personal Information">
              <p>Footy Status does not sell personal information.</p>
              <p>Footy Status does not sell children&rsquo;s personal information.</p>
              <p>
                We do not rent personal information to third parties for their independent marketing
                purposes.
              </p>
            </Section>

            <Section title="7. Advertising and Tracking">
              <p>
                Footy Status does not currently use personal information for cross-app targeted
                advertising.
              </p>
              <p>
                We do not currently authorize third-party advertising networks to track Footy Status
                users across unrelated apps and websites for targeted advertising.
              </p>
              <p>
                If these practices change, we will update this Privacy Policy and request any legally
                required permissions.
              </p>
            </Section>

            <Section title="8. Children and Minors">
              <p>Protecting younger users is important to Footy Status.</p>
              <p>
                Footy Status may include players who are minors. Certain functionality may therefore
                depend on age and parent or guardian involvement.
              </p>
              <p>
                Where applicable law requires verifiable parental consent before personal information
                is collected from a child, Footy Status will seek appropriate consent before providing
                functionality requiring that information.
              </p>
              <p>
                Footy Status may provide parent-child linking and parental functionality intended to
                support younger users.
              </p>
              <p>
                For younger accounts, Footy Status may limit features, visibility, communication,
                notifications, or other functionality where appropriate.
              </p>
              <p>
                We seek to collect only information reasonably necessary to provide the applicable
                Services.
              </p>
              <p>
                Footy Status does not knowingly sell children&rsquo;s personal information or knowingly
                use children&rsquo;s personal information for targeted advertising.
              </p>
              <p>
                A parent or legal guardian who believes their child has provided personal information
                improperly, or who wants to exercise applicable rights concerning a child&rsquo;s
                information, may contact:
              </p>
              <p>
                <SupportEmail />
              </p>
              <p>
                We may take reasonable steps to verify the requester&rsquo;s identity and relationship
                to the child.
              </p>
              <p>
                If we determine that children&rsquo;s information was collected in violation of
                applicable legal requirements, we will take appropriate action, including deletion
                where required.
              </p>
            </Section>

            <Section title="9. User-Generated Content and Moderation">
              <p>Footy Status may review, moderate, reject, restrict, preserve, or remove content.</p>
              <p>Moderation may occur to:</p>
              <List
                items={[
                  "Protect users",
                  "Protect minors",
                  "Enforce Community Guidelines",
                  "Investigate reports",
                  "Prevent harassment",
                  "Prevent bullying",
                  "Address sexual or inappropriate content",
                  "Address violent or threatening content",
                  "Prevent fraud or impersonation",
                  "Address illegal activity",
                  "Protect intellectual property",
                  "Maintain platform integrity",
                  "Comply with law",
                ]}
              />
              <p>
                Footy Status may also warn, restrict, suspend, or terminate accounts that violate our
                policies.
              </p>
            </Section>

            <Section title="10. Blocking and Reporting">
              <p>
                Where available, users may report inappropriate accounts or content and block other
                users.
              </p>
              <p>Reports may be reviewed by Footy Status.</p>
              <p>
                Submitting a report does not guarantee a particular enforcement outcome. We evaluate
                available information and determine appropriate action based on our policies and
                circumstances.
              </p>
            </Section>

            <Section title="11. Data Retention">
              <p>
                We retain information for as long as reasonably necessary for the purposes for which it
                was collected, including to:
              </p>
              <List
                items={[
                  "Operate Footy Status",
                  "Maintain accounts",
                  "Provide requested functionality",
                  "Maintain account relationships",
                  "Protect users",
                  "Prevent fraud",
                  "Maintain security",
                  "Resolve disputes",
                  "Enforce our agreements",
                  "Comply with legal obligations",
                ]}
              />
              <p>Different information may have different retention periods.</p>
              <p>
                We may retain limited records after account deletion when reasonably necessary or
                legally permitted, including records relating to security, fraud, transactions, legal
                obligations, disputes, enforcement, or abuse prevention.
              </p>
              <p>
                Backup copies may persist temporarily until overwritten through ordinary backup and
                disaster-recovery processes.
              </p>
            </Section>

            <Section title="12. Account Deletion">
              <p>Users may initiate permanent account deletion through Footy Status.</p>
              <p>Deleting an account is different from logging out.</p>
              <p>
                Following a valid permanent deletion request, we will take reasonable steps to delete
                or de-identify information associated with the account that we are not required or
                permitted to retain.
              </p>
              <p>This may include, as applicable:</p>
              <List
                items={[
                  "Account information",
                  "Profile information",
                  "Profile pictures",
                  "Videos",
                  "Comments",
                  "Likes",
                  "Team relationships",
                  "Player relationships",
                  "Parent-child relationships",
                  "Soccer information",
                  "Other user-generated content associated with the account",
                ]}
              />
              <p>
                Certain information may be retained where reasonably necessary for legal compliance,
                security, fraud prevention, transaction records, dispute resolution, abuse prevention,
                or enforcement.
              </p>
              <p>
                Users may contact <SupportEmail /> regarding deletion.
              </p>
            </Section>

            <Section title="13. Privacy Rights">
              <p>
                Depending on applicable law and where you live, you may have rights including the right
                to request:
              </p>
              <List
                items={[
                  "Access to personal information",
                  "Correction of inaccurate information",
                  "Deletion of information",
                  "Information concerning our processing practices",
                  "A copy of certain information",
                  "Withdrawal of consent where applicable",
                  "Other rights provided by applicable law",
                ]}
              />
              <p>Requests may be submitted to:</p>
              <p>
                <SupportEmail />
              </p>
              <p>We may need to verify your identity before processing a request.</p>
              <p>
                Authorized parents or guardians may submit applicable requests concerning their
                children.
              </p>
            </Section>

            <Section title="14. Camera and Photo Library">
              <p>
                Footy Status may request access to the camera, photo library, or media on a device
                when necessary to allow users to:
              </p>
              <List
                items={[
                  "Select profile pictures",
                  "Upload soccer videos",
                  "Record or select highlight clips",
                  "Upload other requested media",
                ]}
              />
              <p>Users can manage these permissions through their device settings.</p>
              <p>
                Footy Status should only request permissions reasonably related to features the user
                chooses to use.
              </p>
            </Section>

            <Section title="15. Security">
              <p>
                We use reasonable administrative, technical, and organizational safeguards designed to
                protect information.
              </p>
              <p>
                However, no application, database, internet transmission, or electronic storage system
                can guarantee absolute security.
              </p>
              <p>
                Users are responsible for protecting their account credentials and should notify us
                promptly if they suspect unauthorized account access.
              </p>
            </Section>

            <Section title="16. Legal and Safety Disclosures">
              <p>
                We may preserve, access, or disclose information if we reasonably believe doing so is
                necessary to:
              </p>
              <List
                items={[
                  "Comply with law",
                  "Respond to lawful legal process",
                  "Respond to valid governmental requests",
                  "Investigate illegal activity",
                  "Protect minors",
                  "Prevent harm",
                  "Investigate fraud",
                  "Protect Footy Status",
                  "Protect our users",
                  "Enforce our agreements",
                  "Establish, exercise, or defend legal claims",
                ]}
              />
            </Section>

            <Section title="17. Business Transfers">
              <p>
                If Footy Status undergoes a merger, acquisition, financing, restructuring, bankruptcy,
                sale of assets, or similar business transaction, information may be transferred as part
                of that transaction, subject to applicable law.
              </p>
            </Section>

            <Section title="18. International Processing">
              <p>
                Information may be processed or stored in locations different from where a user lives,
                including through our service providers.
              </p>
              <p>
                Where legally required, appropriate safeguards will be used for international transfers.
              </p>
            </Section>

            <Section title="19. Third-Party Links">
              <p>Users may encounter links to third-party websites or services.</p>
              <p>
                Footy Status does not control and is not responsible for the privacy practices,
                content, or security of independent third parties.
              </p>
            </Section>

            <Section title="20. Changes to This Policy">
              <p>We may update this Privacy Policy as Footy Status changes.</p>
              <p>When we make changes, we will update the &ldquo;Last Updated&rdquo; date.</p>
              <p>
                Where required, we may provide additional notice or obtain consent for material
                changes.
              </p>
            </Section>

            <Section title="21. Contact Us">
              <p>
                Questions, concerns, privacy requests, parent or guardian requests, and
                account-deletion inquiries may be directed to:
              </p>
              <p>Footy Status</p>
              <p>
                Email: <SupportEmail />
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

export default PrivacyPolicyPage;
