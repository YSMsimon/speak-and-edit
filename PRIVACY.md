# Privacy policy: Speak and Edit

Last updated: November 7, 2026

Speak and Edit is a free, open-source Chrome extension (MIT licence, source at https://github.com/YSMsimon/speak-and-edit). It turns requests said in a Google Meet call into edits in your own Google Docs, Sheets and Slides. There is no Speak and Edit server: the extension runs in your browser and talks only to the services listed below, the ones you choose to connect.

## What it reads

- **Google Meet captions.** While you're in a call, it reads the live captions Meet shows in your tab, with each speaker's name and photo. It doesn't record audio.
- **The files you connect.** The Google Docs, Sheets and Slides you add in Outputs. It reads them to place edits in the right spot.
- **The shared screen, when asked.** A still of the shared screen when someone asks for a screenshot or for what's on screen, and a recording of the Meet tab only when you press Record.
- **Your Google name and photo**, so your own lines show your name instead of "You".

## Where it goes

- **The AI you pick** in the AI model tab gets the request, recent lines of the meeting, and an outline of your connected files. That's either the model built into Chrome (it stays on your computer) or your ChatGPT plan, through Sign in with ChatGPT. OpenAI's privacy policy applies to what it receives.
- **Your files** get the edits, comments and credit lines Scribe writes, through Google's APIs.
- **Your Google Drive** gets screenshots and recordings, in a "Scribe captures" folder. To insert a picture, Google Docs and Slides need a link: the picture is shared by link for a few seconds while Google copies it, then made private again.

Nothing is sent to the developer, sold, or used for advertising. There are no analytics.

## What it keeps on your computer

Kept in Chrome's storage on this computer, never synced:
- your settings and API keys
- saved meetings (the lines, results and summaries), kept 30 days
- a log of the AI requests and their results, kept 30 days

Both are deleted after 30 days. Removing the extension removes everything it stored.

## Google user data

Speak and Edit's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Google data is used only to read and edit the files you connect, save your captures to your Drive, and show your name; it isn't transferred to anyone except the AI provider you choose, as described above, and never for advertising. Speak and Edit doesn't use your Google data to develop or train AI models; what an AI provider does with the requests it receives is set by that provider's terms. Sign out in Outputs withdraws Speak and Edit's access to your Google account.

## Contact

Questions or requests: open an issue at https://github.com/YSMsimon/speak-and-edit/issues.
