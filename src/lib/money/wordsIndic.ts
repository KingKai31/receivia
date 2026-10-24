import { MoneyError } from './errors';
import type { Paise } from './paise';
import { amountInWordsIndian } from './words';

// Hindi and Marathi have an irregular word for every number below 100, so they are listed in full.
const HI_100 = [
  'शून्य',
  'एक',
  'दो',
  'तीन',
  'चार',
  'पाँच',
  'छह',
  'सात',
  'आठ',
  'नौ',
  'दस',
  'ग्यारह',
  'बारह',
  'तेरह',
  'चौदह',
  'पंद्रह',
  'सोलह',
  'सत्रह',
  'अठारह',
  'उन्नीस',
  'बीस',
  'इक्कीस',
  'बाईस',
  'तेईस',
  'चौबीस',
  'पच्चीस',
  'छब्बीस',
  'सत्ताईस',
  'अट्ठाईस',
  'उनतीस',
  'तीस',
  'इकतीस',
  'बत्तीस',
  'तैंतीस',
  'चौंतीस',
  'पैंतीस',
  'छत्तीस',
  'सैंतीस',
  'अड़तीस',
  'उनतालीस',
  'चालीस',
  'इकतालीस',
  'बयालीस',
  'तैंतालीस',
  'चौवालीस',
  'पैंतालीस',
  'छियालीस',
  'सैंतालीस',
  'अड़तालीस',
  'उनचास',
  'पचास',
  'इक्यावन',
  'बावन',
  'तिरपन',
  'चौवन',
  'पचपन',
  'छप्पन',
  'सत्तावन',
  'अट्ठावन',
  'उनसठ',
  'साठ',
  'इकसठ',
  'बासठ',
  'तिरसठ',
  'चौंसठ',
  'पैंसठ',
  'छियासठ',
  'सड़सठ',
  'अड़सठ',
  'उनहत्तर',
  'सत्तर',
  'इकहत्तर',
  'बहत्तर',
  'तिहत्तर',
  'चौहत्तर',
  'पचहत्तर',
  'छिहत्तर',
  'सतहत्तर',
  'अठहत्तर',
  'उनासी',
  'अस्सी',
  'इक्यासी',
  'बयासी',
  'तिरासी',
  'चौरासी',
  'पचासी',
  'छियासी',
  'सत्तासी',
  'अट्ठासी',
  'नवासी',
  'नब्बे',
  'इक्यानवे',
  'बानवे',
  'तिरानवे',
  'चौरानवे',
  'पंचानवे',
  'छियानवे',
  'सत्तानवे',
  'अट्ठानवे',
  'निन्यानवे',
];

const MR_100 = [
  'शून्य',
  'एक',
  'दोन',
  'तीन',
  'चार',
  'पाच',
  'सहा',
  'सात',
  'आठ',
  'नऊ',
  'दहा',
  'अकरा',
  'बारा',
  'तेरा',
  'चौदा',
  'पंधरा',
  'सोळा',
  'सतरा',
  'अठरा',
  'एकोणीस',
  'वीस',
  'एकवीस',
  'बावीस',
  'तेवीस',
  'चोवीस',
  'पंचवीस',
  'सव्वीस',
  'सत्तावीस',
  'अठ्ठावीस',
  'एकोणतीस',
  'तीस',
  'एकतीस',
  'बत्तीस',
  'तेहतीस',
  'चौतीस',
  'पस्तीस',
  'छत्तीस',
  'सदतीस',
  'अडतीस',
  'एकोणचाळीस',
  'चाळीस',
  'एक्केचाळीस',
  'बेचाळीस',
  'त्रेचाळीस',
  'चव्वेचाळीस',
  'पंचेचाळीस',
  'सेहेचाळीस',
  'सत्तेचाळीस',
  'अठ्ठेचाळीस',
  'एकोणपन्नास',
  'पन्नास',
  'एक्कावन्न',
  'बावन्न',
  'त्रेपन्न',
  'चौपन्न',
  'पंचावन्न',
  'छप्पन्न',
  'सत्तावन्न',
  'अठ्ठावन्न',
  'एकोणसाठ',
  'साठ',
  'एकसष्ट',
  'बासष्ट',
  'त्रेसष्ट',
  'चौसष्ट',
  'पासष्ट',
  'सहासष्ट',
  'सदुसष्ट',
  'अडुसष्ट',
  'एकोणसत्तर',
  'सत्तर',
  'एक्काहत्तर',
  'बाहत्तर',
  'त्र्याहत्तर',
  'चौऱ्याहत्तर',
  'पंच्याहत्तर',
  'शहात्तर',
  'सत्याहत्तर',
  'अठ्ठ्याहत्तर',
  'एकोणऐंशी',
  'ऐंशी',
  'एक्क्याऐंशी',
  'ब्याऐंशी',
  'त्र्याऐंशी',
  'चौऱ्याऐंशी',
  'पंच्याऐंशी',
  'शहाऐंशी',
  'सत्त्याऐंशी',
  'अठ्ठ्याऐंशी',
  'एकोणनव्वद',
  'नव्वद',
  'एक्क्याण्णव',
  'ब्याण्णव',
  'त्र्याण्णव',
  'चौऱ्याण्णव',
  'पंच्याण्णव',
  'शहाण्णव',
  'सत्त्याण्णव',
  'अठ्ठ्याण्णव',
  'नव्व्याण्णव',
];

interface Words {
  below100: string[];
  hundred: string;
  thousand: string;
  lakh: string;
  crore: string;
  rupees: string;
  paise: string;
  and: string;
  only: string;
}

const HI: Words = {
  below100: HI_100,
  hundred: 'सौ',
  thousand: 'हज़ार',
  lakh: 'लाख',
  crore: 'करोड़',
  rupees: 'रुपये',
  paise: 'पैसे',
  and: 'और',
  only: 'मात्र',
};
const MR: Words = {
  below100: MR_100,
  hundred: 'शे',
  thousand: 'हजार',
  lakh: 'लाख',
  crore: 'कोटी',
  rupees: 'रुपये',
  paise: 'पैसे',
  and: 'आणि',
  only: 'फक्त',
};

function integerWords(w: Words, n: number): string {
  if (n === 0) return w.below100[0]!;
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${integerWords(w, crore)} ${w.crore}`);
  if (lakh) parts.push(`${w.below100[lakh]!} ${w.lakh}`);
  if (thousand) parts.push(`${w.below100[thousand]!} ${w.thousand}`);
  if (hundreds) {
    parts.push(
      w === MR
        ? hundreds === 1
          ? 'शंभर'
          : `${w.below100[hundreds]!}${w.hundred}`
        : `${w.below100[hundreds]!} ${w.hundred}`,
    );
  }
  if (rest) parts.push(w.below100[rest]!);
  return parts.join(' ');
}

/** Hindi or Marathi words for an amount, e.g. "एक लाख अठारह हज़ार रुपये मात्र". */
export function amountInWordsIndic(p: Paise, lang: 'hi' | 'mr'): string {
  if (p < 0) {
    throw new MoneyError('NEGATIVE_NOT_ALLOWED', 'Amount in words needs a non-negative amount');
  }
  const w = lang === 'hi' ? HI : MR;
  const rupees = Math.floor(p / 100);
  const ps = p % 100;
  let out = `${integerWords(w, rupees)} ${w.rupees}`;
  if (ps) out += ` ${w.and} ${w.below100[ps]!} ${w.paise}`;
  return `${out} ${w.only}`;
}

export function amountInWordsFor(p: Paise, lang: string): string {
  return lang === 'hi' || lang === 'mr' ? amountInWordsIndic(p, lang) : amountInWordsIndian(p);
}
