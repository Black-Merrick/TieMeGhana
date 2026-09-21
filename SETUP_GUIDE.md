# Setup Guide

Everything needed to get Tie Me Ghana running locally. Should take under ten
minutes on a machine that already has Python, Node, and Docker.

## Requirements

| Tool | Version used | Notes |
| --- | --- | --- |
| Python | 3.13 | 3.12 also fine |
| Node | 22 or newer | |
| Docker | any recent | Only needed for PostgreSQL, or for the full stack |
| ffmpeg | any recent | Stitches a sentence into one video. Without it clips play in sequence instead |

## 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
```

Confirm the baseline before writing anything new:

```bash
pytest
```

This runs against SQLite by default, so PostgreSQL is not required just to run
the suite. Leave `DATABASE_URL` unset in `.env` for that fallback.

Run the dev server:

```bash
python manage.py migrate
python manage.py runserver
```

The API is then at `http://localhost:8000/api/`. Check it:

```bash
curl http://localhost:8000/api/health/
# {"status":"ok","database":"ok"}
```

If you already have another Django project holding port 8000, run this one
elsewhere and tell the frontend proxy where to find it:

```bash
python manage.py runserver 8001
```

Then set `VITE_API_PROXY_TARGET=http://localhost:8001` in
`frontend/.env.local`.

### Using PostgreSQL locally

Day to day development only needs the database in Docker. Django and the
frontend stay native for fast reloads.

```bash
docker compose up -d db
```

Then set this in `backend/.env`:

```
DATABASE_URL=postgres://tiemeghana:tiemeghana@localhost:5432/tiemeghana
```

Run `python manage.py migrate` again after switching.

## 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

The app is then at `http://localhost:5173`, or the next free port if 5173 is
taken. It shows "Connected to the hospital system" once it can reach the
backend health endpoint, which is the fastest way to confirm both halves are
talking to each other.

The dev server proxies `/api` and `/media` to Django, which is exactly what
nginx does in the containerized stack. That means the frontend only ever calls
the relative path `/api`, so a CORS or absolute URL mistake cannot show up in
deployment after working locally.

```bash
npm test        # unit tests
npm run lint    # ESLint, must pass with zero warnings
npm run build   # production PWA build
```

## 3. Enforce the standards automatically

From the project root, once:

```bash
pip install pre-commit
pre-commit install
```

Every `git commit` now runs Black, isort, and Ruff on Python files and ESLint
on JS and JSX files before the commit is allowed through. See
[ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md) section 2.

## 4. Optional, the full containerized stack

Use this to confirm the app behaves the way it will in a real deployment, not
for daily development.

```bash
docker compose -f docker-compose.full.yml up --build
```

The app is then at `http://localhost:8080`, with nginx proxying `/api` to
Django. Rebuilding on every code change is much slower than native hot
reload, which is why this is not the default workflow.

## Khaya AI credentials

Twi speech recognition, translation, and text to speech run through GhanaNLP's
Khaya AI. Put the key in `backend/.env`, **never in `.env.example`**, which is
committed:

```
KHAYA_API_KEY=your-key-here
LANGUAGE_PROVIDER=stub
```

### We are on the free tier, so keep `LANGUAGE_PROVIDER=stub`

Every translation, transcription, and speech call spends metered credit.
`LANGUAGE_PROVIDER=stub` means the key can stay configured without being used,
so ordinary development cannot exhaust the quota you need for judging.

Switch it deliberately when you actually want to test against real Twi, then
switch it straight back:

```
LANGUAGE_PROVIDER=khaya
```

The whole test suite forces the stub regardless of your `.env`, so running
`pytest` never costs credit.

With the stub, translation returns the text **unchanged** rather than inventing
Twi. That is deliberate, fabricated clinical Twi would look right in a demo and
be wrong in front of a Twi speaking judge. The app shows a visible notice
whenever a caption came from the stub, so it can never be mistaken for real
translation.

## Reviewing and approving clips

The Django admin is where footage is uploaded, approved or rejected, aliases
are recorded, and the question wording is curated. Create an account once:

```bash
cd backend && source .venv/bin/activate
python manage.py createsuperuser
```

Then open **http://localhost:5173/admin/**, or whichever port the dev server
reported. The admin is proxied through the dev server, so it is on the same
port as the app rather than the backend's. In production it is at
`https://your-site.netlify.app/admin/`, proxied the same way.

### Getting footage in: two ways, for two situations

**Bulk upload**, the button on the **GhSL clips** list, is a form: pick as
many video files as you like from your own computer and submit. This is the
one that works after deployment. Render's free tier has no shell and no
persistent disk, so there is no folder on the server to drop files into and
nobody who could reach one if there were. Whoever is reviewing clips against
the live site does it through this form, from whichever machine they are
sitting at.

Each file's name, minus its extension, becomes the gloss it is filed under:
`head.mp4` becomes `HEAD`, `what_is_your_name.mp4` becomes
`WHAT_IS_YOUR_NAME`. The form shows a running list of exactly which gloss each
selected file will become, before you upload, so a typo in a filename is
caught before it quietly creates the wrong entry. It also lists which glosses
in the library still need footage, so you can name files correctly the first
time rather than discover a mismatch on the next review pass.

**Import footage folder**, the other button, reads a folder on whichever
machine Django is actually running on: `backend/footage/` locally by default,
or `FOOTAGE_DIR`. Only useful with direct filesystem access to that machine,
which in practice means local development. Kept because it is convenient
there: drop a folder of files in and click one button, rather than open a
terminal for `manage.py import_clips`. On a deployment with no shell it does
nothing, because there is no way to have put files in the folder it reads.

Either way, importing is not the same as approving. **Imported footage is
always `pending` until someone approves it.** That is the gate, not a bug:
filmed is not the same as usable. A clip only becomes resolvable, reachable
by a patient, when it is both filmed and approved.

Uploading a file for a gloss that already has one **replaces the recording and
resets its approval**, on purpose: whoever approved the old take did not see
the new one, so the new one goes back to pending regardless of what the old
status was.

### Approving, rejecting, and sending back for a retake

Three outcomes, each a bulk action in the clip list, and each means something
different enough to a future reviewer that they are worth telling apart:

- **Approve** clears selected, filmed clips for clinical use, recording your
  name. A clip with no footage is skipped rather than approved, since
  approving a gloss with nothing to play would be a lie the row tells.
- **Reject** is for a specific recording a consultant has watched and refused.
  It asks for a reason before doing anything, on a confirmation page, and
  keeps that reason on the clip with your name and the date. That reason is
  what lets whoever re-films it fix the actual problem instead of guessing,
  and what lets a second reviewer see the gloss was already tried rather than
  assume it is untouched.
- **Return to pending, for rework** is the quieter cousin: for a recording
  that just is not finished yet, rather than one you are actively refusing.
  It carries no reason, because rejecting an unfinished take would leave a
  false "somebody said no to this" mark on a clip nobody has properly judged.

Opening a clip's own page shows the current recording playing inline, above
the file field, so judging it does not mean downloading the file first.

## ffmpeg, so a sentence plays as one video

A signed sentence is several clips. ffmpeg concatenates them into a single
video file so the patient sees one continuous utterance with one timeline,
rather than several clips each restarting the timer.

```bash
sudo apt install ffmpeg      # Debian, Ubuntu, Kali
brew install ffmpeg          # macOS
```

Without ffmpeg the app still works: the clips play back to back through two
buffers, which looks continuous but shows each clip's own length in the control
bar. The backend logs that it is falling back, and no request fails. See
ADR 030 and ADR 031.

Each stitched sentence is encoded once and cached in
`backend/media/stitched/`, keyed by the exact ordered clips it contains, so a
repeated sentence is served from disk.

## Speaking instead of typing

The doctor can speak in English or Twi as well as type. The microphone button
sits beside Send, and the language choice applies to both.

**The microphone only appears on a secure connection.** `getUserMedia`
requires a secure context, which `localhost` and `127.0.0.1` satisfy, so it
works during development on the machine running the server. Opening the app
from a phone over plain http does not, and the browser offers no microphone and
no error at all. The app detects this and says the connection needs https.

So for any demo where the doctor's device is **not** the machine running the
server, serve the app over https or the microphone will not be there. Typing
works either way, which is why it stays a first class path rather than a
fallback. See ADR 017.

## Adding filmed GhSL clips

The clip library starts with 92 glosses recorded and **zero** usable clips,
because no footage has been filmed yet. Until footage exists, captions
correctly report every word as unavailable.

```bash
cd backend
python manage.py seed_clips --report   # what the library still needs
```

Drop recordings into `backend/footage/`, named after their English gloss
(`head.webm`, `hurt.mp4`, `a.webm`), then:

```bash
python manage.py import_clips footage/
```

Imported footage is filmed but **not approved**, so it still cannot reach a
patient. See [backend/footage/README.md](backend/footage/README.md) for the
naming rules, the approval step, and why re-importing resets approval.


## Media storage

GhSL clips, medicine photographs and the stitched videos built from them are
"media": files the app stores rather than ships. Where they live is chosen by
environment variables, and the default is deliberate.

**Locally, leave the `R2_*` variables blank.** Media goes to `backend/media/`
on disk. A fresh clone needs no cloud account to run the app or the tests.

**On a deployment, fill them in.** This is not a preference. A container's
filesystem is replaced on every restart and every deploy, so a prescription
issued on Monday would have lost its photographs by Tuesday, and the QR code a
patient took home would resolve to broken images.

Cloudflare R2 is the one wired up because it charges nothing for egress, and
this application serves video.

### Getting the four values

1. Sign in at **dash.cloudflare.com** and open **R2** in the left sidebar. The
   free tier needs a card on file but is not charged below 10 GB of storage.

2. **Create a bucket.** Any name; `tiemeghana-media` is the obvious one. That
   name is `R2_BUCKET`.

3. **Find the account id.** It is in the dashboard URL, the long hex string
   after `dash.cloudflare.com/`, and also shown on the R2 overview page as part
   of the S3 API endpoint. That is `R2_ACCOUNT_ID`.

4. **Create an API token.** R2 > **Manage API tokens** > **Create API token**,
   permission **Object Read & Write**, scoped to the bucket from step 2. The
   Access Key ID and the Secret Access Key are shown **once**: copy both now,
   into `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Losing the secret means
   making a new token, not recovering the old one.

5. **Make the bucket readable.** Open the bucket, **Settings**, and either
   enable the **r2.dev** public URL or connect a custom domain. Copy the
   hostname without the scheme or a trailing slash into `R2_PUBLIC_HOST`, for
   example `pub-1a2b3c4d.r2.dev`.

   This step is easy to miss and fails in a confusing way: uploads succeed,
   nothing errors, and every video and photograph 404s in the browser. Writing
   goes to the authenticated endpoint, reading goes to this public host, and
   they are different addresses.

Then paste all five into `backend/.env`, which is gitignored. Never into
`.env.example`, which is tracked: that file is the template, and a real key in
it is a key published to anyone who clones the repository.

### Checking it worked

```bash
cd backend && . .venv/bin/activate
python manage.py shell -c "
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
name = default_storage.save('checks/hello.txt', ContentFile(b'hello'))
print('stored as:', name)
print('served at:', default_storage.url(name))
default_storage.delete(name)
"
```

A `https://pub-....r2.dev/checks/hello.txt` URL means it is wired up. A
`/media/...` path means the variables were not picked up and it is still
writing to local disk.

### Moving the clips you have already imported

Existing files in `backend/media/` are not copied automatically. Either drop
the footage into `backend/footage/` and run `import_clips` again with R2
configured, or upload `backend/media/` into the bucket with `rclone` or the
dashboard, keeping the folder names as they are.

## Deploying

In [DEPLOY.md](DEPLOY.md): the two platforms, every environment variable
each one needs, and the four things that fail quietly if they are missed.
