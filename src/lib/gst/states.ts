/** GST state / UT codes (2-digit). Includes 97 (Other Territory) and 99 (Centre Jurisdiction). */
export const GST_STATES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
} as const;

export type StateCode = keyof typeof GST_STATES;

export class GstError extends Error {
  readonly code: 'UNKNOWN_STATE_CODE' | 'INVALID_RATE' | 'INVALID_LINE';
  constructor(code: GstError['code'], message: string) {
    super(message);
    this.name = 'GstError';
    this.code = code;
  }
}

export function isStateCode(code: string): code is StateCode {
  return Object.prototype.hasOwnProperty.call(GST_STATES, code);
}

/** Throws GstError for any code not in the table. */
export function assertStateCode(code: string): StateCode {
  if (!isStateCode(code)) {
    throw new GstError('UNKNOWN_STATE_CODE', `Unknown GST state code: "${code}"`);
  }
  return code;
}

export function stateName(code: string): string {
  return GST_STATES[assertStateCode(code)];
}
