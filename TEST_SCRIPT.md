# Scribe test script

Read the lines aloud in a Google Meet call, one at a time. Every mode and setting is covered. It takes about 35 minutes; section 8 (shared screen) needs a second person presenting.

After each line, pause for about 3 seconds. Scribe sends a line 1.5 s after Meet puts the full stop on it, so if you keep talking, two lines become one.

Tick each box as you go. When one fails, write down its number and what the panel showed (see the end).

---

## 0. Set up (once, about 5 minutes)

### Three test files

Make these in Google Drive. Use the exact titles.

1. **Doc: `Scribe Test Doc`.** Type four headings, and give each one a heading style (Format › Paragraph styles › Heading 2). Bold text isn't enough: Scribe finds sections by their heading style.
   - `Decisions`, with the line `Use MySQL for the database` under it
   - `Action items` (empty)
   - `Open questions` (empty)
   - `Notes`, with the line `Launch date is December 1` under it
2. **Sheet: `Scribe Test Tasks`.**
   - Row 1: `Task` | `Owner` | `Status` | `Due`
   - Row 2: `Write the spec` | `Alex` | `In progress` | `Nov 5`
3. **Slides: `Scribe Test Deck`.**
   - Slide 1: title `Scribe demo`.
   - Slide 2: "Title and body" layout, title `Roadmap`, body `Beta in November`.

### The extension

1. On `chrome://extensions`, click the reload arrow on Scribe.
2. Open the three files as tabs in one window, then open the Scribe side panel. In **Outputs**, click **Add** next to each file under "Open in this window". If Google asks for permissions, allow all of them.
3. In **AI model**, click **Continue with ChatGPT** and sign in with a Plus or Pro account (or pick **Built into the browser**). The green dot means it's ready.
4. Set the starting state:
   - **Live**: Commands, Auto.
   - **Outputs**: How changes land is **Edit the file**, Work on is **Any file**, and **Credit each change** is on.
5. Go to `meet.google.com/new` and join. Keep the side panel open. The header should say Listening. If Meet's captions are off, press `c`.

### The wake word

Start each command with "Scribe", said clearly. Check what Meet writes in the captions:
- Scribe, Scribes or Skribe: these work.
- "Subscribe!", "Describe" or "Scrub" (Meet's usual mishearings) work too: Scribe asks the AI once whether the line was a request for it. "Describe the flow for me" or "Subscribe! Hello, how are you?" does nothing.
- Script or Describe: these don't. Say it more slowly, or change the wake word in AI model.
- Your own lines should show your Google name and photo, not "You". Other people show their Meet name and photo.

---

## 1. Commands mode, Auto (about 7 minutes)

Auto writes straight into the file: no suggestions, nothing to accept.

### Docs

| # | Say | What should happen |
|---|---|---|
| ☐ 1.1 | "Scribe, add to decisions: we're using Postgres 16." | Card **Added: Scribe Test Doc › Decisions**. The line is in the Doc as normal text, not green. It has a comment with your name, the time and what you said. |
| ☐ 1.2 | "Scribe, change MySQL to Postgres in decisions." | Card **Changed**. The Doc now says Postgres where it said MySQL. |
| ☐ 1.3 | "Scribe, comment on the launch date: this might slip a week." | Card **Comment**. A comment is attached to "Launch date is December 1". The text itself doesn't change. |
| ☐ 1.4 | "Scribe, what's the launch date?" | Scribe answers in the panel ("December 1"). Nothing is written. |

### Sheets and Slides (Scribe should pick the right file itself)

| # | Say | What should happen |
|---|---|---|
| ☐ 1.5 | "Scribe, add a task: Simon sets up staging by Friday." | Card **Added: Scribe Test Tasks › Sheet1 row 3**. Row 3 reads Set up staging, Simon, (blank), Friday, with a credit note on A3. |
| ☐ 1.6 | "Scribe, mark write the spec as done." | C2 changes to Done. The note on C2 says "Was: In progress". |
| ☐ 1.7 | "Scribe, on the roadmap slide, add GA in January." | Slide 2 gets a new line, "GA in January", under the existing text. The credit goes into slide 2's speaker notes. |
| ☐ 1.8 | "Scribe, add a new slide called Risks, with database migration." | A new slide 3, titled Risks, with "Database migration" in the body. |

### Lines that should NOT write anything

| # | Say | What should happen |
|---|---|---|
| ☐ 1.9 | "We should probably add Redis too." | The line appears, and nothing else happens. There's no wake word. |
| ☐ 1.10 | "I told the scribe yesterday the spec was fine." | Nothing happens. "Scribe" isn't one of the first words. |
| ☐ 1.11 | "Scribe is pretty cool, right?" | Card **Not a command**. Nothing is written. |
| ☐ 1.12 | "Scribe, move it to next week." | Scribe should ask which one you mean and offer 2–3 choices, such as the launch date or the spec's due date. Pick one and click Send, and it writes that change. If Scribe picks one without asking, write that down: the model got it wrong, but nothing broke. |

### Typing instead of talking

| # | Do | What should happen |
|---|---|---|
| ☐ 1.13 | Click the **keyboard button** at the bottom right of Live, type `add to open questions: do we need SSO for the beta?` and press Enter | The same as saying it: added under Open questions. The box closes again after sending. |
| ☐ 1.14 | Open the box again, type `what did we decide today?` and press Enter | An answer based on the Doc. Nothing is written. |

---

## 2. Ask before writing (about 3 minutes)

In the bottom-left of the Live tab, click **Auto** and pick **Ask before writing**; stay in Commands. The button should now say **Ask first**.

| # | Say or do | What should happen |
|---|---|---|
| ☐ 2.1 | "Scribe, add to action items: send the recap email." | Card **Suggestion: Scribe Test Doc › Action items**, right away. In the Doc it's a green suggested line, with your credit comment on it. "1 waiting for you" appears at the top. |
| ☐ 2.2 | Click **Accept** on that card. | The card says Accepted. In the Doc the line turns into normal text. |
| ☐ 2.3 | "Scribe, change Postgres to MySQL in decisions." Then click **Reject** on its card. | First a suggestion ("Postgres" crossed out, "MySQL" in green). After Reject, the Doc says Postgres again. |
| ☐ 2.4 | "Scribe, add a task: book the demo room." | Sheets can't hold suggestions, so a card waits with **Approve** and **Discard**. The Sheet doesn't change. Click **Discard**: "Discarded. Nothing was written." |
| ☐ 2.5 | "Scribe, add a task: order pizza for the demo." Then: "Scribe, on the roadmap slide add the demo date." | Two waiting cards, and **Approve all (2)** at the top. Click it, and both are written. |

Set it back to **Auto** (bottom-left picker).

---

## 3. Smart mode (about 5 minutes)

In the bottom-left of the Live tab, click **Commands** and pick **Smart**. Talk normally, without saying "Scribe"; it decides what to write by itself, and it also does what you ask without the wake word ("Can you take a screenshot?"). Lines shorter than 3 words are skipped without asking the AI.

| # | Say | What should happen |
|---|---|---|
| ☐ 3.1 | "Hey, can everyone hear me okay?" | Nothing. It's small talk. |
| ☐ 3.2 | "I think maybe Stripe, or maybe Paddle, I'm not sure yet." | Nothing. It's still being discussed. |
| ☐ 3.3 | "Okay, final call, we're going with Stripe for payments." | Added under **Decisions** (Auto, so no suggestion). |
| ☐ 3.4 | "Simon, can you build the billing page by Friday?" | A new **row in the Sheet**: Billing page, Simon, Friday. |
| ☐ 3.4a | "Can you add a comment saying thanks, everyone?" (no "Scribe") | A **comment** on the doc, not text in it. |
| ☐ 3.4b | "Can you switch to command mode?" (no "Scribe") | Card **Scribe: Switched to Commands mode.** Then switch back to Smart. |
| ☐ 3.4c | "Priya, can you share your screen?" | Nothing. It's for Priya, not Scribe. |
| ☐ 3.4d | "Can you add a comment on the line about the beta date, saying check this with Wei?" (no "Scribe") | A **comment** on the "Beta: …" line that says "Check this with Wei". If Meet mishears the line and two lines are close, a card asks **"Which line did you mean?"** with the real lines to tap. |
| ☐ 3.4e | "Can you pause?" then, straight away, "Hello, can you hear me?" | "Paused". The second line disappears from the panel and isn't used, even though it was said while the pause was still being worked out. |
| ☐ 3.5 | "We still don't know who owns customer support, let's come back to that." | Added under **Open questions**. |
| ☐ 3.6 | "The API limit is one hundred requests per minute." | Added under **Notes**. |
| ☐ 3.7 | "Testing, testing, one two three." | Nothing. |
| ☐ 3.8 | "Actually, the launch moves to December eighth." | The launch date in Notes is changed to December 8. If Scribe adds a new line instead of changing the old one, write down which it did. |
| ☐ 3.9 | "Scribe, add a slide called Payments." | A new slide. Wake-word commands still work in Smart mode. |
| ☐ 3.10 | "So yeah, we're going with Stripe for payments." | Nothing, because it's already in the Doc. If it adds Stripe again, that's a miss. |

Now turn on **Ask before writing**:

| # | Say | What should happen |
|---|---|---|
| ☐ 3.11 | "Okay, decided, the beta is invite only." | A suggestion under **Decisions** in the Doc, waiting for Accept. |
| ☐ 3.12 | "Alex will write the launch blog post next week." | A waiting card titled **Action item: Add to Scribe Test Tasks**. Click Discard. |

Set it back to **Auto** (bottom-left picker).

---

## 4. Record all (about 3 minutes)

In the bottom-left of the Live tab, pick **Record all**. This mode uses no AI.

| # | Say | What should happen |
|---|---|---|
| ☐ 4.1 | "Let's start with the agenda." / "First item is the launch." / "Second item is hiring." | Each line first shows "Going into Transcript in Scribe Test Doc…", then "In Transcript" about 3 seconds later. In the Doc, a new **Transcript** heading appears at the very end, with lines like `Simon (14:31): Let's start with the agenda.` |
| ☐ 4.2 | "Scribe, add to decisions: we hire two engineers." | This goes into the Transcript as an ordinary line. Record all doesn't run spoken edits; typed requests and "Scribe, switch to …" requests still work (section 9). |
| ☐ 4.3 | Turn on Ask before writing. Say "This line should wait for me." Then say "This one I'll skip." | Both lines wait with **Add** and **Skip**. Click Add on the first, and it lands under Transcript. Click Skip on the second, and it's never written. |
| ☐ 4.4 | Set the picker back to Auto. Read 8 or more short sentences quickly, without long pauses. | They arrive in one or two batches, in order, with nothing written twice. Check one thing in particular: there should be no half sentence followed by the same sentence in full. Meet revises its captions as it goes, and Scribe is supposed to handle that. |

---

## 5. How changes land (about 3 minutes)

In the bottom-left pickers, go back to **Commands**, with Auto on. The setting for this section is in **Outputs › How changes land**: **Edit the file** or **Comments only**.

| # | Setting, then say | What should happen |
|---|---|---|
| ☐ 5.1 | **Comments only**. "Scribe, add to decisions: we drop Mongo." | Card **Comment**. A comment on the Decisions heading reads "Proposed: …" with your name. The Doc text doesn't change. The line under the Live switch says "Comments only". |
| ☐ 5.2 | Still comments only. "Scribe, add a task: clean up the repo." | A note on cell A1 of the Sheet that reads "Proposed: …". No new row. |
| ☐ 5.3 | Still comments only. "Scribe, on the roadmap slide add mobile app." | A new line in slide 2's speaker notes. The slide itself doesn't change. |
| ☐ 5.4 | **Edit the file**, and turn **Credit each change** off. "Scribe, add to notes: no credit test." | Added with no comment on it. Then turn credit back on. |

---

## 6. People (about 2 minutes)

Your name shows up in the People tab once you've spoken.

| # | Setting, then say | What should happen |
|---|---|---|
| ☐ 6.1 | Set yourself to **Comments only**. "Scribe, add to notes: role test." | It's saved as a comment, and the card says "… is set to comments only." |
| ☐ 6.2 | Set yourself to **Ignore**. "Scribe, add to notes: you shouldn't see this." | The line appears, and nothing else happens. |
| ☐ 6.3 | Set yourself back to **Can edit**. "Scribe, add to notes: credit test." | The credit comment reads `Simon, 14:40: “add to notes: credit test”`, with your name and the current time. |

---

## 7. Optional

| # | Do | What should happen |
|---|---|---|
| ☐ 7.1 | Click **Pause** in the header; the badge should say Paused. Say "Scribe, add to notes: paused test." Then resume and say it again. | While paused, nothing shows up in the panel. After you resume, it works. |
| ☐ 7.2 | Switch AI model to **Built into the browser**, then redo 1.1 and 3.3. | The same results as with ChatGPT, maybe slower. Write down anything it gets wrong. |
| ☐ 7.3 | Join the call from your phone as a guest named "Alex", and admit them. From the phone, say "Scribe, add to notes: second person test." | The line shows the speaker as Alex, and the credit names Alex. Alex appears in People with a role you can change. |
| ☐ 7.4 | Say "Scribe, add Postgres 16 to", wait about 3 seconds, then "Decisions." | One line, one change under Decisions. Scribe waits up to 5 seconds when a sentence ends in "to", "and", "the" or a comma. |
| ☐ 7.5 | Say "Scribe," then stop for about 3 seconds. Then say "add to notes: pause test." | The bare "Scribe," shows nothing; the second line is bold and acted on. The next line within 8 seconds counts as the request. |
| ☐ 7.6 | Say "Scribe, add to notes: quick test." and stop. Watch how soon the card appears. | About 1.5 seconds after the full stop shows in Meet's captions, plus the AI's time. If Meet adds no full stop, 4 seconds. |

---

## 8. Shared screen (about 6 minutes)

**You need a second person presenting.** When you present your own screen, Meet may not show it back to you, so there's nothing for Scribe to copy.

The easiest way to test alone:
1. Open an Incognito window. The extension is off there.
2. Join the same call as a guest named "Priya", and admit her from your main window.
3. From Incognito, click **Present now** and share a tab showing the Sheet or a slide with a small table.

Before you start:
- Sign out of Google in Outputs and sign in again, and allow the new Drive permission. It only covers files Scribe creates.
- Open the Meet tab, then click Scribe's icon in the toolbar while you're on it. Chrome only lets Scribe record a tab after it was opened on that tab.
- In Outputs, set **Screenshots and recordings go to** to Scribe Test Deck.

| # | Do or say | What should happen |
|---|---|---|
| ☐ 8.1 | Wait a few seconds after Priya starts presenting. | The Live tab says "Priya is sharing". If it still says "Nobody is sharing", the shared screen wasn't found. Write that down; it's the part most likely to need a fix. |
| ☐ 8.2 | Click **Screenshot**. | A card with the picture. A new slide appears in Scribe Test Deck with the screenshot under a title like "Shared screen 14:32". A **Scribe captures** folder appears in your Drive. Open the image's sharing settings there: it should be private again (restricted, not "Anyone with the link"). |
| ☐ 8.3 | Say "Scribe, screenshot this and put it in the doc." | The picture appears in Scribe Test Doc under a new **Shared screen** heading, with an italic caption linked to the original in Drive. |
| ☐ 8.4 | Show a table on Priya's screen. Say "Scribe, add this table to the tasks sheet." | No picture this time. Each row of the table becomes a new row in Scribe Test Tasks, lined up with the columns. The card shows the screenshot it read. |
| ☐ 8.5 | Say "Scribe, screenshot this into the tasks sheet." | A **Scribe captures** tab in the Sheet, with a row that links to the picture in Drive. The amber line about Sheets not holding pictures is expected. |
| ☐ 8.6 | Turn on **Save each new slide**. Click through three slides on Priya's screen, pausing about 3 seconds on each. | Three new slides in the deck, one per slide shown. Move the mouse over one slide: nothing new is saved. Play a video: nothing is saved while it plays. |
| ☐ 8.7 | Turn on **Ask before writing**, then change the slide once more. | A card with the picture and Approve / Discard. Nothing reaches Drive until you click Approve. |
| ☐ 8.8 | Click **Record**, talk for about 20 seconds, then click **Stop**. | The header shows "Recording 0:12" while it runs, and you can still hear the call. After Stop, a new slide plays the video (Drive may need a few minutes to process it). If Chrome asks which tab to share instead, Scribe wasn't opened on the Meet tab; pick the Meet tab and it still works. |
| ☐ 8.9 | With nobody presenting, say "Scribe, screenshot this." | A red card: nobody is sharing their screen. Nothing is saved. |

## 9. Changing Scribe by voice (about 5 minutes)

Every line here is a request to Scribe itself. Each one shows a card titled **Scribe: …** with the settings it changed. Start from Commands, Auto, Work on: Any file.

| # | Say | What should happen |
|---|---|---|
| ☐ 9.1 | "Scribe, switch to Smart mode." | Card **Scribe: Switched to Smart mode.** The mode picker (bottom-left) now says Smart. |
| ☐ 9.2 | "Scribe, work on the tasks sheet." | **Working on Scribe Test Tasks.** The header says "Working on Scribe Test Tasks". |
| ☐ 9.3 | "Scribe, add order new laptops." | It goes to the Sheet as a new row, because no file was named. |
| ☐ 9.4 | "Scribe, use any file." | The header goes back to "3 files connected". |
| ☐ 9.5 | "Scribe, let me approve changes before they go in." | The approval picker (bottom-left) now says **Ask first**. |
| ☐ 9.6 | "Scribe, just make the edits directly." | Back to **Auto**. |
| ☐ 9.7 | "Scribe, record everything." | **Record all** mode. It must NOT start a video recording. |
| ☐ 9.8 | "Scribe, switch back to commands mode." | Back to Commands. This works even from Record all. |
| ☐ 9.9 | "Scribe, pause." Then "We should add Redis." Then "Scribe, add Redis to decisions." Then "Scribe, resume." | The badge says Paused. The two middle lines never appear in the panel and nothing is written. "Scribe, resume" shows **Listening again.** |
| ☐ 9.10 | "Scribe, start recording the call." | The header shows "Recording 0:01". If you didn't click Scribe's icon while on the Meet tab, the card shows a red line asking for a click instead. Pressing Record then works. |
| ☐ 9.11 | "Scribe, pause the recording." Then "Scribe, resume the recording." Then "Scribe, stop recording." | The badge says "Recording paused", then counts again, then the recording is saved as in 8.8. The paused time isn't counted in its length. |
| ☐ 9.12 | "Scribe, switch to Smart mode, work on the doc, and ask before writing." | One card with three changes. Then say "Scribe, switch to commands mode and use any file" to go back. |
| ☐ 9.13 | Set yourself to **Comments only** in People. "Scribe, switch to Smart mode." | A red card: comments-only people can't change Scribe's settings. Set yourself back to **Can edit**. |

## 10. Saved meetings, leaving the call, background tab (about 10 minutes)

Commands mode, Auto, the test Doc as the working file.

| # | Do | What should happen |
|---|---|---|
| ☐ 10.1 | Put Meet in a background tab (open the Doc in front) for 10 minutes. Have the other person say a few lines, then "Scribe, add to notes: background test." | Every line is in the panel, nothing missing, and the edit lands. Meet keeps updating captions while its tab is hidden. |
| ☐ 10.2 | Close the side panel. Have the other person say two lines, then "Scribe, add to notes: closed panel test." Open the panel again. | Everything from before is still there. The three lines appear under "Heard while the panel was closed, not run", and the request did **not** run. |
| ☐ 10.3 | Say "Scribe, add to notes: before leaving." Click Leave call, wait a minute, click Rejoin. Say "Scribe, add to notes: after rejoining." | A line "Scribe heard nothing from … to …" between the two. Both edits land. |
| ☐ 10.4 | Close the Meet tab, open the meeting link again in a new tab and join. | Same meeting in the panel (nothing lost), with a "heard nothing" line for the time in between. |
| ☐ 10.5 | Quit Chrome completely, reopen it, rejoin and open the panel. | Same meeting, everything still there. |
| ☐ 10.6 | About 25 lines after something specific was said (a number, a date), say "Scribe, add what <their name> said about … to decisions." | It finds the right line from earlier, not just the last few. |
| ☐ 10.7 | Outputs › Also › Saved meetings › Delete, then Delete all? | The Live tab empties and a toast says how many were deleted. The call keeps going as a new meeting. |
| ☐ 10.8 | Say "Scribe, add to decisions." then, after about a second, "We're using Postgres 16." | One request: Postgres 16 under Decisions. Meet's first full stop doesn't cut it in half. |
| ☐ 10.9 | Switch to another tab so Meet opens its picture-in-picture window, and keep talking for a minute. | The header still says Listening, and your lines keep arriving. |
| ☐ 10.10 | After the call, run `node scripts/eval-report.mjs`. | A report with the calls, outcomes and any flagged mistakes from this call. |

---

## When something fails

Send me these three things:

1. The test number.
2. A screenshot of the panel card. If it's a red error card, its text alone is usually enough.
3. What actually ended up in the file.

If a line never shows up in the panel at all, check Meet's captions first. If the caption is missing or the wake word is spelled wrong, the problem is the caption reader, not the AI.
