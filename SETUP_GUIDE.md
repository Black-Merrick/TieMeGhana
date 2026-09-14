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

The Django admin is where footage is approved, aliases are recorded, and the
question wording is curated. Create an account once:

```bash
cd backend && source .venv/bin/activate
python manage.py createsuperuser
```

Then open **http://localhost:5173/admin/**, or whichever port the dev server
reported. The admin is proxied through the dev server, so it is on the same
port as the app rather than the backend's.

Under **GhSL clips** you can approve imported footage, see which glosses still
need filming, add reviewed aliases, and import the footage folder with a
button.

Imported footage is always `pending` until someone approves it. That is the
gate, not a bug: filmed is not the same as usable. A clip only becomes
resolvable when it is both filmed and approved.

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


## Deploying: backend on Render, frontend on Netlify

One repository, two deployments. Each platform is pointed at its own directory,
so a backend change does not rebuild the frontend and a frontend change does not
redeploy Django. `render.yaml` and `netlify.toml` hold the settings; both can
also be typed into the dashboards by hand.

Do the backend first. The frontend needs its address.

### 1. The backend, on Render

**New > Web Service**, connect the repository, then:

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Runtime | Docker |
| Health Check Path | `/api/health/` |
| Instance Type | Free |

Add a **PostgreSQL** instance in the same dashboard and copy its internal
connection string into `DATABASE_URL`.

Environment variables, all under **Environment**:

```
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<generate a long random string>
DJANGO_SECURE_SSL=1
DATABASE_URL=<from the Render database>
LANGUAGE_PROVIDER=stub
R2_ACCOUNT_ID / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_PUBLIC_HOST
```

`DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` need
the Netlify domain, which does not exist yet. Leave them for step 3.

The service's own hostname is added to `ALLOWED_HOSTS` automatically from
`RENDER_EXTERNAL_HOSTNAME`. Forgetting it otherwise fails in a way that reads
like a crash: every request returns `DisallowedHost`, including Render's own
health check, so the deploy is marked failed before any log line explains it.

Migrations run on start, from `backend/entrypoint.sh`. There is nothing to run
by hand.

### 2. The frontend, on Netlify

**Add new site > Import an existing project**, same repository. `netlify.toml`
supplies the settings, so the form should already show base `frontend`, command
`npm run build`, publish `dist`.

**Then edit `netlify.toml`** and replace `tiemeghana-api.onrender.com` in the
three redirects with the Render service's real address. Commit and it
redeploys.

Those redirects are why the app calls `/api/...` in deployment exactly as it
does in development: the browser sees one origin. No CORS preflight on every
request, and no backend URL baked into the bundle that would need a rebuild to
change.

### 3. Back to Render, with the Netlify domain

```
DJANGO_ALLOWED_HOSTS=<your-site>.netlify.app
CORS_ALLOWED_ORIGINS=https://<your-site>.netlify.app
CSRF_TRUSTED_ORIGINS=https://<your-site>.netlify.app
```

The scheme matters in the last two. Django ignores a bare hostname there
silently, so the setting looks configured and does nothing.

### 4. R2, one more setting

In the bucket's **Settings > CORS policy**, allow the Netlify origin for `GET`.

Video playback does not need this; `<video src>` works cross origin. Caching a
prescription for offline replay does: that goes through `fetch()`, which
without CORS headers fails, and the screen honestly reports "Saved 0 of 4 sign
clips". It is the one part of FR 6.2 that breaks quietly.

### What to expect on the free tier

The backend **sleeps after about 15 minutes** of no traffic, and the next
request takes 30 to 60 seconds while it wakes. On a demo that is fatal: a judge
taps and nothing happens. Open the app yourself a minute before presenting.

Stitching is CPU work on a shared free instance, so the first prescription is
slow. Every later one for the same medicines is served from the cache in R2,
because the filename is a hash of the clips it contains. Opening each
prescription once, ahead of time, is enough.

The frontend does not sleep. Netlify serves static files from a CDN, so the
patient facing half is always instant even when the backend is cold.


## Deploying: backend on Render, frontend on Netlify

One repository, two deployments. Each platform is pointed at its own directory,
so a backend change does not rebuild the frontend and a frontend change does
not redeploy Django. `render.yaml` and `netlify.toml` hold the settings and can
also be typed into the dashboards by hand.

Do the backend first. The frontend needs its address.

### 1. Backend, on Render

**New > Web Service**, connect the repository:

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Runtime | Docker |
| Health Check Path | `/api/health/` |
| Instance Type | Free |

Add a **PostgreSQL** instance in the same dashboard, then set the variables
listed below. Migrations run on start from `backend/entrypoint.sh`; there is
nothing to run by hand.

The service's own hostname is added to `ALLOWED_HOSTS` automatically from
`RENDER_EXTERNAL_HOSTNAME`. Without that, forgetting it fails in a way that
reads like a crash: every request returns `DisallowedHost`, including Render's
own health check, so the deploy is marked failed before a log line explains it.

### 2. Frontend, on Netlify

**Add new site > Import an existing project**, same repository. `netlify.toml`
supplies base `frontend`, command `npm run build`, publish `dist`.

Then **edit `netlify.toml`** and replace `tiemeghana-api.onrender.com` in the
three redirects with the real Render address. Commit, and it redeploys.

Those redirects are why the app calls `/api/...` in deployment exactly as it
does in development: the browser sees one origin. No CORS preflight on every
request, and no backend URL compiled into the bundle that would need a rebuild
to change.

### 3. R2, one more setting

In the bucket's **Settings > CORS policy**, allow the Netlify origin for `GET`.

Playback does not need it: a `<video src>` works cross origin. Saving a
prescription for offline replay does, because that goes through `fetch()`,
which without CORS headers fails and the screen honestly reports "Saved 0 of 4
sign clips". It is the one part of FR 6.2 that breaks quietly.

### What the free tier does

The backend **sleeps after about 15 minutes** of no traffic and takes 30 to 60
seconds to wake. On a demo that is fatal: a judge taps and nothing happens.
Open the app yourself a minute beforehand.

Stitching is CPU work on a shared instance, so the first prescription is slow
and every later one for the same medicines is served from the cache in R2,
because the filename is a hash of the clips it contains. Opening each
prescription once, ahead of time, is enough.

The frontend does not sleep. Netlify serves it from a CDN, so the patient
facing half is instant even when the backend is cold.
