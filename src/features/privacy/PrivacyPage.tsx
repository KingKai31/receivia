import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, LanguagePicker } from '@/components/ui';

export const PRIVACY_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'Who is responsible',
    body: [
      "Receivia is a tool a business uses to collect money it is owed. The business decides why and how its customers' details are used; Receivia handles them on the business's behalf. If a business contacted you, questions about your details go to that business first, at the contact details on its invoice.",
    ],
  },
  {
    title: 'What is stored',
    body: [
      "For the business: the owner's sign-in email, the business profile (name, GSTIN, address, bank and UPI details), invoices, payments, bank statement lines, expenses and settings.",
      'About customers: name, GSTIN, phone, email, address, the messages sent to them, what they told the business through the pay page (a payment claim, a dispute or a promise), and a record of whether they agreed to be contacted.',
      'About errors: when something breaks on a screen, the page address and the error message are saved so it can be fixed. They contain no invoice or customer details.',
    ],
  },
  {
    title: 'Why it is used',
    body: [
      'To issue invoices, remind customers about unpaid invoices, match payments, estimate cash flow and keep the records the business needs. It is not sold and it is not used for advertising.',
    ],
  },
  {
    title: 'Contacting customers',
    body: [
      "Customers are contacted by email, or by WhatsApp only if they have opted in. A customer can ask the business to stop at any time. The business records that on the customer's page and Receivia stops using that channel from the next plan.",
    ],
  },
  {
    title: 'Where it is kept and who else sees it',
    body: [
      "The database and sign-in are hosted by Supabase in the ap-northeast-1 region (Tokyo, Japan). The web app is served by Render. Email is sent through Resend. Message wording may be drafted by Anthropic's Claude, which is given the stage of the reminder, the language and the business name, but not phone numbers, email addresses or amounts.",
    ],
  },
  {
    title: 'How long it is kept',
    body: [
      'Invoices, notes and payment records are kept for as long as the business keeps its account, because accounting and tax rules generally expect businesses to keep such records for several years. The business should confirm the period with its CA. Error reports are kept until the organisation is deleted. When an organisation is deleted, its data is removed and the personal data inside its audit log is wiped; only a record that the deletion happened is kept.',
    ],
  },
  {
    title: 'Your choices',
    body: [
      "A business owner can download all of the business's data (JSON and CSV) and permanently delete the organisation from Settings, after typing its name to confirm. Anyone whose details are held can ask the business to correct or erase them, or to stop contacting them.",
    ],
  },
  {
    title: 'Complaints',
    body: [
      "Contact the business first. A grievance contact for Receivia itself will be published here; until then, write to the email address on the business's invoice. This notice is general information and is not legal advice.",
    ],
  },
];

export function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <main id="main" className="app-main flex flex-col gap-4" style={{ maxWidth: 760 }}>
      <div className="app-top">
        <span className="brand">{t('brand')}</span>
        <LanguagePicker />
      </div>
      <h1>{t('Privacy notice')}</h1>
      <p>
        {t(
          "This explains what data Receivia handles, why, where it is kept and what choices people have. It follows the idea of India's Digital Personal Data Protection Act, 2023 and is written in plain words.",
        )}
      </p>
      {PRIVACY_SECTIONS.map((s) => (
        <Card key={s.title} title={s.title}>
          {s.body.map((b) => (
            <p key={b}>{t(b)}</p>
          ))}
        </Card>
      ))}
      <p>
        <Link to="/trust">{t('pages.trust')}</Link> {t('·')} <Link to="/">{t('Open the app')}</Link>
      </p>
    </main>
  );
}
