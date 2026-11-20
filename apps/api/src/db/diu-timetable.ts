/**
 * DIU's published bus timetable, used as the starting data for new installs and
 * the demo. The transport office changes routes and times in the dashboard
 * afterwards; this file is not read again once the database is seeded.
 *
 * Source: https://daffodilvarsity.edu.bd/article/transport
 * "Transport Schedule Final Exam, Semester: Spring-2026", last update 23 April 2026.
 *
 * - Trips marked "Only for Employees" on the website (4:20 PM) are faculty/staff
 *   trips; every other trip is a regular trip that students and staff share.
 * - The website's Friday table (F1–F4, with F4 printed twice) is attached to the
 *   matching regular route, so riders keep their home route on Fridays. Where the
 *   Friday path differs, the trip carries a note.
 * - Durations are estimates for planning bus turnarounds, and stop coordinates are
 *   approximate (for the route map only). Both need checking by the transport office.
 */

export type TripDays = 'sat-thu' | 'fri';
export interface TimetableTrip {
  dir: 'to_campus' | 'from_campus';
  /** 24-hour HH:MM. */
  at: string;
  days?: TripDays;
  employeesOnly?: boolean;
  note?: string;
}
export interface TimetableRoute {
  code: string;
  name: string;
  kind: 'regular' | 'shuttle';
  durationMinutes: number;
  /** From the far end towards DSC; DSC itself is added by the seed. */
  stops: [name: string, lat: number, lng: number][];
  trips: TimetableTrip[];
}

export const DIU_TIMETABLE_SOURCE = {
  url: 'https://daffodilvarsity.edu.bd/article/transport',
  title: 'Transport Schedule Final Exam, Semester: Spring-2026',
  lastUpdate: '2026-04-23',
};

/** Daffodil Smart City, as given in the university website's own metadata. */
export const DSC_STOP = { name: 'Daffodil Smart City (DSC)', lat: 23.8770, lng: 90.3201 };

const SAT_THU = [6, 0, 1, 2, 3, 4];
const FRI = [5];
export const weekdaysFor = (days: TripDays = 'sat-thu') => (days === 'fri' ? FRI : SAT_THU);

const to = (at: string, note?: string): TimetableTrip => ({ dir: 'to_campus', at, ...(note ? { note } : {}) });
const from = (at: string, note?: string): TimetableTrip => ({ dir: 'from_campus', at, ...(note ? { note } : {}) });
const employees = (at: string): TimetableTrip => ({ dir: 'from_campus', at, employeesOnly: true, note: 'Only for employees' });
const friday = (inAt: string, outs: string[], note?: string): TimetableTrip[] => {
  const trips: TimetableTrip[] = [{ dir: 'to_campus', at: inAt, days: 'fri' }, ...outs.map((at): TimetableTrip => ({ dir: 'from_campus', at, days: 'fri' }))];
  return note ? trips.map((t) => ({ ...t, note })) : trips;
};

/** The common pattern: to DSC at 7:00, 10:00 and 1:00; back at 11:20, 2:30 and 5:30. */
const standard = (withEmployeeBus: boolean, outNote?: string): TimetableTrip[] => [
  to('07:00'), to('10:00'), to('13:00'),
  from('11:20', outNote), from('14:30', outNote), ...(withEmployeeBus ? [employees('16:20')] : []), from('17:30', outNote),
];

const DHANMONDI_TO_BIRULIA: TimetableRoute['stops'] = [
  ['Dhanmondi - Sobhanbag', 23.7592, 90.3762], ['Shyamoli Square', 23.7746, 90.3654], ['Technical Mor', 23.7806, 90.3527],
  ['Majar Road (Gabtoli)', 23.7905, 90.3478], ['Konabari Bus Stop (Mirpur)', 23.8006, 90.3462], ['Eastern Housing', 23.8197, 90.3489],
  ['Rupnagar', 23.8216, 90.3466], ['Birulia Bus Stand', 23.8530, 90.3290],
];

export const DIU_TIMETABLE: TimetableRoute[] = [
  {
    code: 'R1', name: 'Dhanmondi', kind: 'regular', durationMinutes: 80,
    stops: DHANMONDI_TO_BIRULIA,
    trips: [...standard(true), ...friday('07:30', ['11:30', '16:30'])],
  },
  {
    code: 'R2', name: 'Uttara - Rajlokkhi', kind: 'regular', durationMinutes: 50,
    stops: [['Uttara - Rajlokkhi', 23.8636, 90.3999], ['House Building', 23.8745, 90.4004], ['Grand Zamzam Tower', 23.8693, 90.3884],
      ['Diyabari Bridge', 23.8797, 90.3703], ['Beribadh', 23.8195, 90.3395], ['Birulia', 23.8540, 90.3300], ['Khagan', 23.8722, 90.3242]],
    trips: [...standard(true), ...friday('07:30', ['11:30', '16:30'])],
  },
  {
    code: 'R3', name: 'Tongi College Gate', kind: 'regular', durationMinutes: 50,
    stops: [['Tongi College Gate Bus Stand', 23.8935, 90.4035], ['Kamarpara', 23.8990, 90.3830], ['Dhour', 23.8890, 90.3640], ['Birulia', 23.8540, 90.3300]],
    trips: [...standard(true), ...friday('07:30', ['11:30', '16:30'], 'Friday route: Tongi College Gate > Abdullahpur > Uttara House Building > DSC')],
  },
  {
    code: 'R4', name: 'ECB Chattor - Mirpur', kind: 'regular', durationMinutes: 75,
    stops: [['ECB Chattor', 23.8183, 90.3925], ['Kalshi Mor', 23.8209, 90.3790], ['Mirpur 12', 23.8270, 90.3662], ['Mirpur 10', 23.8069, 90.3687],
      ['Mirpur 2', 23.8050, 90.3610], ['Mirpur 1 - Sony Cinema Hall', 23.7985, 90.3540], ['Commerce College', 23.7952, 90.3507],
      ['Gudaraghat', 23.8033, 90.3441], ['Beribadh', 23.8195, 90.3395], ['Eastern Housing', 23.8197, 90.3489], ['Birulia', 23.8540, 90.3300],
      ['Akran', 23.8683, 90.3262]],
    trips: standard(true),
  },
  {
    code: 'R5', name: 'Konabari - Zirabo - Ashulia', kind: 'regular', durationMinutes: 50,
    stops: [['Konabari Pukur Par', 24.0002, 90.3265], ['Norshingpur', 23.9805, 90.3080], ['Ghosbag', 23.9603, 90.3051], ['Zirabo', 23.9421, 90.3030],
      ['Ashulia Bazar', 23.8975, 90.3195], ['Paragram', 23.8900, 90.3190]],
    trips: [to('07:00'), to('10:00', 'Starts from Jirabo only'), from('14:30'), from('17:30', 'Goes up to Jirabo only')],
  },
  {
    code: 'R6', name: 'Baipail - Nabinagar - C&B', kind: 'regular', durationMinutes: 55,
    stops: [['Baipail', 23.9100, 90.2900], ['Palli Bidyut', 23.9300, 90.2730], ['Nabinagar', 23.9150, 90.2580], ['Bismail', 23.9050, 90.2600],
      ['Prantik', 23.8880, 90.2690], ['JU', 23.8810, 90.2680], ['C&B', 23.8710, 90.2680], ['Kolma', 23.8700, 90.2800],
      ['Charabag', 23.8720, 90.2950], ['Kumkumari', 23.8740, 90.3100]],
    trips: [
      to('07:00'), to('10:00', 'Starts from Polashbari U-turn'), to('13:00', 'Starts from Polashbari U-turn'),
      from('11:20', 'Goes up to Polashbari U-turn only'), from('14:30', 'Goes up to Polashbari U-turn only'), employees('16:20'),
      from('17:30', 'Goes up to Polashbari U-turn only'),
    ],
  },
  {
    code: 'R7', name: 'Dhamrai - Nabinagar - C&B', kind: 'regular', durationMinutes: 65,
    stops: [['Dhamrai Bus Stand', 23.9180, 90.2140], ['Kohinur Market', 23.9150, 90.2300], ['Gonosastho', 23.9100, 90.2500], ['Nabinagar', 23.9150, 90.2580],
      ['Bismail', 23.9050, 90.2600], ['Prantik', 23.8880, 90.2690], ['JU', 23.8810, 90.2680], ['C&B', 23.8710, 90.2680], ['Kolma', 23.8700, 90.2800],
      ['Charabag', 23.8720, 90.2950], ['Kumkumari', 23.8740, 90.3100]],
    trips: standard(false),
  },
  {
    code: 'R8', name: 'Savar - C&B', kind: 'regular', durationMinutes: 45,
    stops: [['Savar Bus Stand', 23.8450, 90.2570], ['Radio Colony', 23.8540, 90.2620], ['C&B', 23.8710, 90.2680], ['Kolma', 23.8700, 90.2800],
      ['Charabag', 23.8720, 90.2950], ['Kumkumari', 23.8740, 90.3100]],
    trips: [...standard(true), ...friday('07:30', ['11:50', '16:50'], 'Friday route: Savar > Nabinagar > C&B > DSC')],
  },
  {
    code: 'R9', name: 'Narayanganj Chasara - Dhanmondi', kind: 'regular', durationMinutes: 130,
    stops: [['Narayanganj Chasara', 23.6230, 90.4990], ['Signboard', 23.6905, 90.4805], ['Shonir Akhra', 23.7020, 90.4430],
      ['Saydabad Bus Stand', 23.7120, 90.4270], ['Gulistan', 23.7250, 90.4120], ['Chankharpul', 23.7230, 90.3990], ...DHANMONDI_TO_BIRULIA],
    trips: [to('06:20'), from('14:30', 'One bus assigned only'), employees('16:20'), from('17:30', 'One bus assigned only')],
  },
  {
    code: 'R10', name: 'Mugda - Malibag - Rampura', kind: 'regular', durationMinutes: 110,
    stops: [['Mugda Medical College', 23.7350, 90.4300], ['Bashabo', 23.7400, 90.4280], ['Malibagh Railgate', 23.7490, 90.4160],
      ['Rampura Bazar', 23.7600, 90.4210], ['Rampura Bridge', 23.7660, 90.4230], ['Middle Badda', 23.7800, 90.4260],
      ['Badda Suvastu Tower', 23.7860, 90.4260], ['Notun Bazar', 23.7980, 90.4240], ['Jamuna Future Park', 23.8130, 90.4240],
      ['Kuril Bisso Road', 23.8180, 90.4200], ['Birulia', 23.8540, 90.3300], ['Khagan', 23.8722, 90.3242], ['Akran', 23.8683, 90.3262],
      ['Eastern Mor', 23.8730, 90.3230]],
    trips: [to('06:20'), from('14:30', 'One bus assigned only'), employees('16:20'), from('17:30', 'One bus assigned only')],
  },
  {
    code: 'R11', name: 'Sony Cinema Hall', kind: 'shuttle', durationMinutes: 45,
    stops: [['Sony Cinema Hall', 23.7985, 90.3540], ['Gudaraghat', 23.8033, 90.3441], ['Beribadh', 23.8195, 90.3395], ['Eastern Housing', 23.8197, 90.3489],
      ['Birulia', 23.8540, 90.3300], ['Akran', 23.8683, 90.3262]],
    trips: [
      ...standard(false, 'Goes up to Mirpur-1 only'),
      ...friday('07:30', ['11:30', '16:30'], 'Friday route: starts at Mirpur-10 (the website lists it as a second F4)'),
    ],
  },
  {
    code: 'R12', name: 'Tongi Station Road', kind: 'shuttle', durationMinutes: 50,
    stops: [['Tongi Station Road', 23.8975, 90.4060], ['Kamarpara', 23.8990, 90.3830], ['Dhour', 23.8890, 90.3640], ['Birulia', 23.8540, 90.3300]],
    trips: standard(false, 'Goes up to Tongi station road only'),
  },
  {
    code: 'R13', name: 'Uttara Moylar Mor', kind: 'shuttle', durationMinutes: 45,
    stops: [['Uttara Moylar Mor', 23.8690, 90.3930], ['Uttara Metro Rail Center', 23.8590, 90.3650], ['Beribadh', 23.8195, 90.3395],
      ['Birulia', 23.8540, 90.3300], ['Khagan', 23.8722, 90.3242]],
    trips: standard(false, 'Goes up to Uttara Moylar Mor only'),
  },
];
