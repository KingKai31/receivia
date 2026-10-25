import { useEffect, useRef, useState } from 'react';
import { Button, Card, Input } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { PayLang } from './payText';

interface Turn {
  role: 'buyer' | 'assistant';
  content: string;
}

const TEXT: Record<
  PayLang,
  { title: string; hint: string; ph: string; send: string; wait: string; down: string }
> = {
  en: {
    title: 'Talk to accounts',
    hint: 'Ask about this invoice, or ask for instalments, an early-payment discount or a pay date. The seller approves anything that needs approval.',
    ph: 'Type your message',
    send: 'Send',
    wait: 'Thinking…',
    down: 'The assistant is not available right now. Please use the buttons on this page.',
  },
  hi: {
    title: 'अकाउंट्स से बात करें',
    hint: 'इस इनवॉइस के बारे में पूछें, या किस्तें, जल्दी भुगतान पर छूट या भुगतान की तारीख माँगें। जिसके लिए मंज़ूरी चाहिए, वह विक्रेता मंज़ूर करता है।',
    ph: 'अपना संदेश लिखें',
    send: 'भेजें',
    wait: 'सोच रहा है…',
    down: 'सहायक अभी उपलब्ध नहीं है। कृपया इस पेज के बटन इस्तेमाल करें।',
  },
  mr: {
    title: 'अकाउंट्सशी बोला',
    hint: 'या इनव्हॉइसबद्दल विचारा, किंवा हप्ते, लवकर पेमेंटवर सूट किंवा पेमेंटची तारीख मागा. मंजुरी लागणाऱ्या गोष्टी विक्रेता मंजूर करतो.',
    ph: 'तुमचा संदेश लिहा',
    send: 'पाठवा',
    wait: 'विचार करत आहे…',
    down: 'सहाय्यक आत्ता उपलब्ध नाही. कृपया या पानावरील बटणे वापरा.',
  },
};

async function chat(body: Record<string, unknown>) {
  const res = await supabase.functions.invoke('buyer-chat', { body });
  if (res.error) throw new Error('chat failed');
  return res.data as {
    enabled: boolean;
    history?: Turn[];
    reply?: string;
    unavailable?: boolean;
  };
}

/** Chat with the seller's accounts assistant. Hidden when the seller has not turned it on. */
export function TalkToAccounts({
  token,
  lang,
  onChanged,
}: {
  token: string;
  lang: PayLang;
  onChanged: () => void;
}) {
  const t = TEXT[lang] ?? TEXT.en;
  const [state, setState] = useState<'loading' | 'off' | 'on'>('loading');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    chat({ token })
      .then((r) => {
        if (!live) return;
        setState(r.enabled ? 'on' : 'off');
        setTurns(r.history ?? []);
      })
      .catch(() => live && setState('off'));
    return () => {
      live = false;
    };
  }, [token]);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'nearest' }), [turns, busy]);

  if (state !== 'on') return null;

  async function send() {
    const m = text.trim();
    if (!m || busy) return;
    setText('');
    setNotice(null);
    setBusy(true);
    setTurns((x) => [...x, { role: 'buyer', content: m }]);
    try {
      const r = await chat({ token, message: m });
      if (r.reply) {
        setTurns((x) => [...x, { role: 'assistant', content: r.reply! }]);
        onChanged();
      } else setNotice(t.down);
    } catch {
      setNotice(t.down);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2>{t.title}</h2>
      <p className="ui-hint">{t.hint}</p>
      <div aria-live="polite" className="chat-log">
        {turns.map((x, i) => (
          <p key={i} className="chat-turn" data-role={x.role}>
            {x.content}
          </p>
        ))}
        {busy ? <p className="chat-turn">{t.wait}</p> : null}
        <div ref={end} />
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          label={t.ph}
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          {t.send}
        </Button>
      </form>
    </Card>
  );
}
