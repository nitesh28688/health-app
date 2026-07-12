import Link from "next/link";
import { TERMS_LAST_UPDATED } from "@/lib/legal";

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-10 text-neutral-800 dark:text-neutral-200">
      <Link href="/" className="text-sm text-indigo-600 dark:text-indigo-400 font-semibold">&larr; Back</Link>
      <h1 className="text-2xl font-black mt-4 mb-1">Privacy Policy</h1>
      <p className="text-sm text-neutral-500 mb-8">Last updated: {TERMS_LAST_UPDATED}</p>

      <div className="flex flex-col gap-6 text-[15px] leading-relaxed">
        <section>
          <h2 className="font-bold text-lg mb-2">1. What we collect</h2>
          <p className="mb-2">To provide the App's features, we collect and store:</p>
          <ul className="list-disc list-inside flex flex-col gap-1">
            <li>Account info: name, username, email, phone (optional)</li>
            <li>Health &amp; body data you enter: weight, height, food logs, workouts, water intake, weight/waist/body-fat measurements, birth date, sex, activity level</li>
            <li>Wellness scan photos (skin, eye, hair) and the AI-generated scores, observations, and recommendations produced from them</li>
            <li>Progress photos, if you choose to add them</li>
            <li>Menstrual cycle tracking data and medication reminders, if you enable those features</li>
            <li>Chat messages you send to the AI assistant</li>
            <li>Friend connections and anything you explicitly choose to share with friends (workouts, diary totals, weight — each is an individual on/off toggle you control)</li>
          </ul>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-2">2. How we use it</h2>
          <p>
            Your data is used only to run the App's features for you: calculating nutrition/
            fitness targets, generating your wellness scan reports, powering the AI assistant's
            answers about your own logged history, and showing your data to friends you've
            explicitly chosen to share it with. We do not sell your personal data.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-2">3. AI processing</h2>
          <p>
            Wellness scan photos and chat messages are sent to Google's Gemini AI (via Google
            Cloud Vertex AI) to generate analysis and responses. This processing is necessary
            for those features to work. We do not use your data to train AI models.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-2">4. Where your data lives</h2>
          <p>
            Account data and logs are stored in a managed Postgres database (Supabase). Photos
            (avatars, progress photos, wellness scans) are stored in Cloudflare R2 object
            storage. Both providers are used solely as infrastructure to run the App — they
            don't use your data for their own purposes.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-2">5. Who can see your data</h2>
          <p>
            By default, your data is private to you. Friends on the App can only see what you
            explicitly turn on for sharing (workouts, daily calorie totals, weight check-ins —
            each is a separate toggle in Settings). Wellness scans, chat history, and health
            tracking data are never shared with friends, regardless of your sharing settings.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-2">6. Notifications</h2>
          <p>
            If you enable push notifications, we use them only for reminders you've opted into
            (e.g. logging reminders, fasting alerts). You can disable these anytime in Settings.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-2">7. Your rights</h2>
          <p>
            You can update or delete most of your data directly in the App (Profile, Settings).
            To delete your account and all associated data entirely, or to request a copy of
            your data, email{" "}
            <a href="mailto:support@linearventures.in" className="text-indigo-600 dark:text-indigo-400 font-semibold">
              support@linearventures.in
            </a>.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-2">8. Children</h2>
          <p>
            The App is not intended for children under 16. We don't knowingly collect data
            from children under 16.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-2">9. Changes to this policy</h2>
          <p>
            If we make material changes to how we handle your data, you'll be asked to review
            and accept the updated policy the next time you sign in.
          </p>
        </section>

        <section>
          <h2 className="font-bold text-lg mb-2">10. Contact</h2>
          <p>
            Questions about this policy or your data? Reach us at{" "}
            <a href="mailto:support@linearventures.in" className="text-indigo-600 dark:text-indigo-400 font-semibold">
              support@linearventures.in
            </a>.
          </p>
        </section>
      </div>
    </main>
  );
}
