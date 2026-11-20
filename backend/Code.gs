/**
 * Holiday program EOI back end (Google Apps Script web app).
 *
 * - GET  ?action=program  -> public program details + places left
 * - POST (JSON, sent as text/plain) -> validate, save to the Sheet, email the info pack
 *
 * Everything you need to edit is in the PROGRAM block below. Search for TODO.
 * Setup steps are in README.md.
 */

// ---------------------------------------------------------------------------
// EDIT THIS: program details. These feed the web page, the confirmation
// screen and the info pack email, so you only change them here.
// ---------------------------------------------------------------------------
const PROGRAM = {
  name: 'Holiday Program',                          // TODO: working title, replace with your name
  organisers: ['Dhwanit', 'Khush'],                 // first names shown on the page
  contactEmail: 'dhwanit2005@gmail.com',           // TODO: reply-to + contact in the pack (use a shared address if you have one)
  contactName: 'Khush',
  contactPhone: '0426 846 426',                      // shown on the page and in the pack for questions
  capacity: 20,                                    // TODO: places offered before the waitlist starts. 0 = no limit
  showPlaces: true,                                // show "X of Y places left" on the page

  // Shown in the "key facts" list on the page and in the pack. Any text works.
  facts: [
    { label: 'When',       value: 'Summer holidays' },
    { label: 'Where',      value: 'Marsden Park Community Centre' },
    { label: 'Group size', value: 'Small groups' }
  ],

  // Form options. Students tick every course they want help with.
  years: ['Year 11', 'Year 12'],
  courses: [
    { subject: 'English',     options: ['English Standard', 'English Advanced'] },
    { subject: 'Mathematics', options: ['Mathematics Standard', 'Mathematics Advanced', 'Mathematics Extension 1', 'Mathematics Extension 2'] },
    { subject: 'Science',     options: ['Physics', 'Chemistry', 'Biology'] }
  ],
  // "How did you hear about this?" If they pick referralOption, the form asks who referred them.
  referralOption: 'A friend referred me',
  heardOptions: ['A friend referred me', 'School', 'Social media', 'Other'],

  privacyNote: "We only use these details to contact you about this program. We don't share them with anyone else.", // TODO check this matches what you actually do

  // Shown on the confirmation screen and in the email.
  messages: {
    interested: "Your interest is registered. Places are confirmed once the dates are final, and we'll contact you then.", // TODO
    waitlist: "Places are full right now, so you're on the waitlist. We'll contact you if a place opens up." // TODO
  },

  // The info pack. Each section can have: facts, lines (bullets) or steps (numbered).
  pack: [
    {
      title: 'Key details',
      facts: [
        { label: 'When',     value: 'Summer holidays (exact dates to be confirmed)' },
        { label: 'Location', value: 'Marsden Park Community Centre' }
      ]
    },
    {
      title: 'What we will cover',
      lines: [
        'Topics are still being finalised. We will build the plan around what the group tells us it wants help with.', // TODO
        'Sessions are small-group, so every student gets time to ask questions.' // TODO check
      ]
    },
    {
      title: 'What to bring',
      lines: [
        'A calculator approved for NESA exams',
        'Your notes or workbooks for the courses you chose',
        'Pens, a notepad and a water bottle'
      ]
    },
    {
      title: 'What happens next',
      steps: [
        'Keep an eye on your email (and check junk) for updates.',
        'We confirm the dates, then contact the parent or guardian.',
        'You confirm your place.' // TODO adjust to your real process
      ]
    },
    {
      title: 'Questions',
      lines: ['Call Khush on 0426 846 426, reply to this email, or write to us at the address above.']
    }
  ]
};

// Organisers who get a short email on every new signup. Leave empty to turn off.
const NOTIFY_EMAILS = []; // e.g. ['you@gmail.com', 'friend@gmail.com']

// ---------------------------------------------------------------------------
// Internals. You should not need to edit below this line.
// ---------------------------------------------------------------------------
const SHEET_NAME = 'Signups';
const TZ = 'Australia/Sydney';
const MIN_FILL_MS = 3000; // faster than this = probably a bot

const HEADERS = [
  'Timestamp', 'Status', 'Position', 'First name', 'Last name', 'Year',
  'School', 'Courses', 'Parent/guardian name', 'Parent/guardian email',
  'Parent/guardian mobile', 'Heard about us', 'Referred by', 'Anything else', 'Info pack emailed', 'Notes'
];
const H = {
  TS: 0, STATUS: 1, POS: 2, FIRST: 3, LAST: 4, YEAR: 5, SCHOOL: 6,
  COURSES: 7, PNAME: 8, PEMAIL: 9, PMOBILE: 10, HEARD: 11, REFERRER: 12, GOALS: 13, EMAILED: 14, NOTES: 15
};
const ST_INTERESTED = 'Interested';
const ST_WAITLIST = 'Waitlist';
// Organisers can type "Withdrawn" in the Status column to free a place.

/** Run this once from the editor to create the sheet and approve permissions. */
function setup() {
  getSheet_();
  MailApp.getRemainingDailyQuota(); // triggers the email permission prompt
}

function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'program') {
    return json_({ ok: true, program: publicProgram_(getSheet_()) });
  }
  return json_({ ok: true });
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'The request was not valid. Reload the page and try again.' });
  }

  const result = validate_(data);
  if (result.errors) {
    return json_({ ok: false, error: 'Fix the highlighted fields and send again.', errors: result.errors });
  }
  if (result.spam) {
    // Bots get a normal-looking success and nothing is saved or sent.
    return json_({
      ok: true, status: ST_INTERESTED, position: null, capacity: PROGRAM.capacity, placesLeft: null,
      alreadyRegistered: false, emailSent: false, firstName: 'there',
      message: PROGRAM.messages.interested, pack: PROGRAM.pack
    });
  }
  const f = result.clean;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    return json_({ ok: false, error: 'The form is busy right now. Wait a few seconds and send again.' });
  }

  let sheet, rowNumber, status, position, existing, rows;
  try {
    sheet = getSheet_();
    rows = readRows_(sheet);

    existing = rows.filter(function (r) {
      return r.v[H.STATUS] !== 'Withdrawn' && String(r.v[H.PEMAIL]).toLowerCase() === f.parentEmail && String(r.v[H.FIRST]).toLowerCase() === f.firstName.toLowerCase();
    })[0];
    if (existing) {
      return json_(buildResponse_({
        status: existing.v[H.STATUS], position: Number(existing.v[H.POS]) || null,
        firstName: f.firstName, rows: rows, alreadyRegistered: true, emailSent: false,
        summary: summary_(existing.v[H.YEAR], existing.v[H.COURSES])
      }));
    }

    const interested = countStatus_(rows, ST_INTERESTED);
    const waitlisted = countStatus_(rows, ST_WAITLIST);
    if (PROGRAM.capacity > 0 && interested >= PROGRAM.capacity) {
      status = ST_WAITLIST;
      position = waitlisted + 1;
    } else {
      status = ST_INTERESTED;
      position = interested + 1;
    }

    rowNumber = sheet.getLastRow() + 1;
    const row = new Array(HEADERS.length).fill('');
    row[H.TS] = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    row[H.STATUS] = status;
    row[H.POS] = String(position);
    row[H.FIRST] = f.firstName;
    row[H.LAST] = f.lastName;
    row[H.YEAR] = f.year;
    row[H.SCHOOL] = f.school;
    row[H.COURSES] = f.courses.join(', ');
    row[H.PNAME] = f.parentName;
    row[H.PEMAIL] = f.parentEmail;
    row[H.PMOBILE] = f.parentMobile;
    row[H.HEARD] = f.heard;
    row[H.REFERRER] = f.referrer;
    row[H.GOALS] = f.goals;
    row[H.EMAILED] = 'No';
    sheet.getRange(rowNumber, 1, 1, HEADERS.length).setValues([row]);
    SpreadsheetApp.flush();
    rows.push({ row: rowNumber, v: row });
  } finally {
    lock.releaseLock();
  }

  // Email outside the lock so a slow send doesn't block other signups.
  let emailSent = false;
  try {
    emailSent = sendPack_(f, status, position);
    if (emailSent) sheet.getRange(rowNumber, H.EMAILED + 1).setValue('Yes');
  } catch (err) {
    console.error('Pack email failed: ' + err);
    sheet.getRange(rowNumber, H.NOTES + 1).setValue('Email failed: ' + String(err).slice(0, 200));
  }
  notifyOrganisers_(f, status, position);

  return json_(buildResponse_({
    status: status, position: position, firstName: f.firstName, rows: rows,
    alreadyRegistered: false, emailSent: emailSent, summary: summary_(f.year, f.courses.join(', '))
  }));
}

function summary_(year, courses) {
  return String(year || '') + ': ' + String(courses || '');
}

function allCourses_() {
  return PROGRAM.courses.reduce(function (all, g) { return all.concat(g.options); }, []);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function str_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

function validate_(d) {
  d = d || {};
  const errors = {};
  const clean = {
    firstName: str_(d.firstName, 60),
    lastName: str_(d.lastName, 60),
    year: str_(d.year, 20),
    school: str_(d.school, 100),
    courses: [],
    parentName: str_(d.parentName, 100),
    parentEmail: str_(d.parentEmail, 120).toLowerCase(),
    parentMobile: str_(d.parentMobile, 20),
    goals: String(d.goals == null ? '' : d.goals).replace(/[ \t]+/g, ' ').trim().slice(0, 500),
    heard: str_(d.heard, 60),
    referrer: str_(d.referrer, 100)
  };

  // Courses: an array of names, each of which must be on the list. Duplicates are dropped.
  const valid = allCourses_();
  const picked = Array.isArray(d.courses) ? d.courses : [];
  let badCourse = false;
  picked.forEach(function (c) {
    c = str_(c, 60);
    if (valid.indexOf(c) === -1) { badCourse = true; return; }
    if (clean.courses.indexOf(c) === -1) clean.courses.push(c);
  });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const phoneRe = /^[0-9+()\-\s]{8,20}$/;

  if (!clean.firstName) errors.firstName = 'Enter the student’s first name.';
  if (!clean.lastName) errors.lastName = 'Enter the student’s last name.';
  if (PROGRAM.years.indexOf(clean.year) === -1) errors.year = 'Choose a year level.';
  if (!clean.school) errors.school = 'Enter the student’s school.';
  if (badCourse) errors.courses = 'Choose courses from the list.';
  else if (!clean.courses.length) errors.courses = 'Choose at least one course.';
  if (!clean.parentName) errors.parentName = 'Enter a parent or guardian’s name.';
  if (!emailRe.test(clean.parentEmail)) errors.parentEmail = 'Enter a valid email address for the parent or guardian.';
  if (clean.parentMobile && !phoneRe.test(clean.parentMobile)) errors.parentMobile = 'Enter a valid mobile number, or leave this blank.';
  if (clean.heard && PROGRAM.heardOptions.indexOf(clean.heard) === -1) clean.heard = '';
  if (clean.heard !== PROGRAM.referralOption) clean.referrer = ''; // only keep a referrer name if they said they were referred
  if (d.consent !== true) errors.consent = 'Tick the box so we can contact you.';

  if (Object.keys(errors).length) return { errors: errors };

  const tooFast = Number(d.elapsed) < MIN_FILL_MS;
  const honeypot = String(d.website || '').length > 0;
  if (tooFast || honeypot) return { spam: true };

  return { clean: clean };
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Plain text everywhere, so nothing a visitor types can run as a formula.
    sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat('@');
  }
  return sh;
}

function readRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS.length).getValues().map(function (v, i) {
    return { row: i + 2, v: v };
  });
}

function countStatus_(rows, status) {
  return rows.filter(function (r) { return r.v[H.STATUS] === status; }).length;
}

function placesLeft_(rows) {
  if (!(PROGRAM.capacity > 0)) return null;
  return Math.max(0, PROGRAM.capacity - countStatus_(rows, ST_INTERESTED));
}

function publicProgram_(sh) {
  const rows = readRows_(sh);
  return {
    name: PROGRAM.name,
    organisers: PROGRAM.organisers,
    facts: PROGRAM.facts,
    years: PROGRAM.years,
    courses: PROGRAM.courses,
    heardOptions: PROGRAM.heardOptions,
    referralOption: PROGRAM.referralOption,
    privacyNote: PROGRAM.privacyNote,
    contactEmail: PROGRAM.contactEmail,
    contactName: PROGRAM.contactName,
    contactPhone: PROGRAM.contactPhone,
    capacity: PROGRAM.capacity,
    showPlaces: PROGRAM.showPlaces,
    placesLeft: placesLeft_(rows)
  };
}

function buildResponse_(o) {
  return {
    ok: true,
    status: o.status,
    position: o.position,
    capacity: PROGRAM.capacity,
    placesLeft: PROGRAM.showPlaces ? placesLeft_(o.rows) : null,
    alreadyRegistered: o.alreadyRegistered,
    emailSent: o.emailSent,
    summary: o.summary || '',
    firstName: o.firstName,
    message: o.status === ST_WAITLIST ? PROGRAM.messages.waitlist : PROGRAM.messages.interested,
    pack: PROGRAM.pack
  };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function packHtml_() {
  return PROGRAM.pack.map(function (s) {
    let body = '';
    if (s.facts) {
      body += '<table role="presentation" style="border-collapse:collapse;width:100%">' + s.facts.map(function (x) {
        return '<tr><td style="padding:4px 12px 4px 0;color:#46526B;vertical-align:top;white-space:nowrap">' + esc_(x.label) +
          '</td><td style="padding:4px 0"><span style="background:#FFE66D;padding:1px 4px">' + esc_(x.value) + '</span></td></tr>';
      }).join('') + '</table>';
    }
    if (s.lines) {
      body += '<ul style="margin:0;padding-left:20px">' + s.lines.map(function (l) {
        return '<li style="margin:4px 0">' + esc_(l) + '</li>';
      }).join('') + '</ul>';
    }
    if (s.steps) {
      body += '<ol style="margin:0;padding-left:20px">' + s.steps.map(function (l) {
        return '<li style="margin:4px 0">' + esc_(l) + '</li>';
      }).join('') + '</ol>';
    }
    return '<h3 style="margin:24px 0 8px;font-size:17px;color:#14213D">' + esc_(s.title) + '</h3>' + body;
  }).join('');
}

function packText_() {
  return PROGRAM.pack.map(function (s) {
    const out = [s.title.toUpperCase()];
    (s.facts || []).forEach(function (x) { out.push(x.label + ': ' + x.value); });
    (s.lines || []).forEach(function (l) { out.push('- ' + l); });
    (s.steps || []).forEach(function (l, i) { out.push((i + 1) + '. ' + l); });
    return out.join('\n');
  }).join('\n\n');
}

function sendPack_(f, status, position) {
  if (MailApp.getRemainingDailyQuota() < 2) return false;
  const lead = status === ST_WAITLIST ? PROGRAM.messages.waitlist : PROGRAM.messages.interested;
  const place = status === ST_WAITLIST ? 'Waitlist no. ' + position : 'Interest no. ' + position;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#14213D;max-width:560px">' +
    '<h2 style="margin:0 0 4px;font-size:22px">' + esc_(PROGRAM.name) + '</h2>' +
    '<p style="margin:0 0 16px;color:#46526B">' + esc_(place) + '</p>' +
    '<p>Hi ' + esc_(f.firstName) + ',</p>' +
    '<p>' + esc_(lead) + '</p>' +
    '<p><strong>You registered for:</strong> ' + esc_(summary_(f.year, f.courses.join(', '))) + '</p>' +
    '<p>Here is the info pack.</p>' + packHtml_() +
    '<p style="margin-top:28px">From ' + esc_(PROGRAM.organisers.join(' and ')) + '</p></div>';
  const text = 'Hi ' + f.firstName + ',\n\n' + lead + '\n\nYou registered for: ' +
    summary_(f.year, f.courses.join(', ')) + '\n\nHere is the info pack.\n\n' + packText_() +
    '\n\nFrom ' + PROGRAM.organisers.join(' and ');

  const opts = {
    to: f.parentEmail,
    subject: PROGRAM.name + ': your info pack',
    body: text,
    htmlBody: html,
    name: PROGRAM.name,
    replyTo: PROGRAM.contactEmail
  };
  MailApp.sendEmail(opts);
  return true;
}

function notifyOrganisers_(f, status, position) {
  if (!NOTIFY_EMAILS.length) return;
  try {
    MailApp.sendEmail(
      NOTIFY_EMAILS.join(','),
      'New signup: ' + f.firstName + ' ' + f.lastName + ' (' + status + ' ' + position + ')',
      f.firstName + ' ' + f.lastName + ', ' + f.school + '\n' + summary_(f.year, f.courses.join(', ')) +
      '\nParent: ' + f.parentName + ', ' + f.parentEmail +
      (f.referrer ? '\nReferred by: ' + f.referrer : '')
    );
  } catch (err) {
    console.error('Notify failed: ' + err);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
