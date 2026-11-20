# Holiday program EOI

Two files do everything:

- `index.html`: the sign-up page. Host it anywhere static (Netlify drag-and-drop works).
- `backend/Code.gs`: a Google Apps Script web app. It saves each signup to a Google Sheet, assigns a place or waitlist position, and emails the info pack to the parent or guardian.

Until you paste in the back end URL, `index.html` runs in preview mode with sample data (capacity 3, so you can see the waitlist after three signups).

## Set up (about 15 minutes)

1. Create a new Google Sheet. Open Extensions, then Apps Script.
2. Delete the starter code and paste in all of `Code.gs`.
3. Edit the `PROGRAM` block at the top (see the checklist below).
4. In Project Settings, set the time zone to Australia/Sydney.
5. Pick `setup` in the function dropdown and press Run. Approve the permissions. Google will warn the app is unverified because you wrote it: choose Advanced, then Go to project. This creates the `Signups` tab.
6. Deploy, then New deployment, type Web app. Execute as: Me. Who has access: Anyone. Copy the URL that ends in `/exec`.
7. Open `index.html`, find `var API_URL = '';` and paste the URL between the quotes.
8. Publish `index.html`. GitHub Pages is set up: merge to `main` and the workflow in `.github/workflows/pages.yml` deploys it to `https://<your-username>.github.io/holiday-program-eoi/`. (Netlify or any static host also works.)
9. Submit a test signup with your own email. Check the Sheet row and the email (including junk).

After you edit `Code.gs` later, go to Deploy, Manage deployments, edit the deployment, choose New version. The URL stays the same.

## Replace the placeholders

In `Code.gs`, search for `TODO`:

- `name`: working title is "Holiday Program".
- `organisers`: your friend's name is a placeholder.
- `contactEmail`: pre-filled with your Gmail. It is the reply-to address, appears in the pack, and is shown publicly on the page as the contact for parents' questions. Use a shared or dedicated address if you'd rather not publish a personal one.
- `capacity`: set to 20. Signups past this go on the waitlist. Use 0 for no limit.
- `facts`: dates, location, group size.
- `years`, `courses`: the year level and course options (English, Mathematics, Science). `referralOption` is the "how did you hear" choice that asks who referred them.
- `messages`, `pack`, `privacyNote`: wording for the confirmation screen, the email and the page footer. Check the privacy line matches what you actually do with the data.
- `NOTIFY_EMAILS`: add your addresses to get an email on every signup.

In `index.html`, the headline, intro paragraph, "How it works" steps and "Common questions" are plain text near the top of the body. Edit them directly, and keep them in line with what you actually do (especially the "no commitment, no payment" wording).

## How it behaves

- Status is `Interested` until `capacity` is reached, then `Waitlist`. The page shows "X of Y places left" and the confirmation shows their number.
- The same parent email and student first name twice returns the existing place and does not send a second email.
- To free a place, type `Withdrawn` in the Status column. Don't delete rows, because positions are counted from the Status column.
- If the email fails (for example the daily quota is used up), the signup is still saved. The row shows `No` under "Info pack emailed" and the reason under Notes.
- Spam protection: a hidden field and a minimum fill time. Bots get a fake success and nothing is stored.
- Cells are stored as plain text, so nothing typed into the form can run as a spreadsheet formula.
- Free Gmail accounts can send about 100 emails a day, counted per recipient. Each signup emails one person (the parent or guardian), so expect roughly 100 signups a day before sending stops.
