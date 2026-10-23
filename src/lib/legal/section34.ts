import { addDays, daysBetween, fiscalYearOf, type ISODate } from '@/lib/dates';

export const GENERAL_INFO_LINE = 'General information, not legal or tax advice.';

/**
 * Section 34 CGST Act: a credit note for an invoice generally has to be issued by 30 November
 * following the end of the financial year of the invoice (or the date the annual return is
 * filed, if earlier). We only know the first date, so it is an upper bound.
 */
export function section34Deadline(invoiceDate: ISODate): ISODate {
  const fy = fiscalYearOf(invoiceDate);
  return `${fy.startYear + 1}-11-30`;
}

export type Section34Level = 'ok' | 'soon' | 'late';

export interface Section34Warning {
  level: Section34Level;
  deadline: ISODate;
  text: string;
}

export function section34Warning(invoiceDate: ISODate, today: ISODate): Section34Warning {
  const deadline = section34Deadline(invoiceDate);
  const left = daysBetween(today, deadline);
  const base =
    'Section 34 of the CGST Act, 2017 generally requires a credit note for an invoice to be issued by 30 November after the end of that invoice’s financial year, or the date the annual return is filed, if that is earlier.';
  if (left < 0) {
    return {
      level: 'late',
      deadline,
      text: `${base} For this invoice that date (${deadline}) appears to have passed, so a credit note issued now may not reduce the tax you have to pay. Check with your CA. ${GENERAL_INFO_LINE}`,
    };
  }
  if (left <= 30) {
    return {
      level: 'soon',
      deadline,
      text: `${base} For this invoice the outer date is ${deadline}, which is ${left} day(s) away, and your annual return may be filed sooner. ${GENERAL_INFO_LINE}`,
    };
  }
  return {
    level: 'ok',
    deadline,
    text: `${base} For this invoice the outer date is ${deadline}. ${GENERAL_INFO_LINE}`,
  };
}

export { addDays };
