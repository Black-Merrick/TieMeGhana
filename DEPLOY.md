# Deploying Tie Me Ghana

One repository, two deployments: the Django API on **Render**, the PWA on
**Netlify**, media in a **Cloudflare R2** bucket. Each platform is pointed at
its own directory, so a backend change does not rebuild the frontend and a
frontend change does not redeploy Django.

`render.yaml` and `netlify.toml` hold the settings and can also be typed into
the dashboards by hand.

Do the backend first. The frontend needs its address.

## How one repository becomes two deployments

Both platforms are connected to **the same repository**. Each is pointed at one
directory and ignores the other:

| | Render | Netlify |
| --- | --- | --- |
| Directory | `rootDir: backend` | `base = "frontend"` |
| Sees | `backend/` as the whole project | `frontend/` as the whole project |
| Rebuilds when | `backend/**` changes | `frontend/**` changes |

The directory setting is also the build context, which is why
`backend/Dockerfile` can say `COPY . .` and get only the backend, and why
`npm run build` finds `frontend/package.json` without any path juggling.

The build filters matter more than they look. Without them every frontend
commit redeploys Django, which on the free tier means a container rebuild, a
migration run and a cold start for whoever happens to be using it, all to ship
a CSS change. And every backend commit spends Netlify build minutes rebuilding
an identical bundle.

**Both platforms deploy from a branch you choose.** Point them at the same one,
or the two halves drift apart: a frontend expecting a field the deployed
backend does not return yet is the kind of mismatch that looks like a bug in
neither.

The two halves are joined by three settings, and nothing else:
`API_PROXY_TARGET` on Netlify points at Render, and `CORS_ALLOWED_ORIGINS` and
`CSRF_TRUSTED_ORIGINS` on Render name the Netlify domain.

---

## 1. Cloudflare R2, the media bucket

Getting the five values is in [SETUP_GUIDE.md](SETUP_GUIDE.md) under **Media
storage**. If it already works locally, the same five values go to Render
unchanged.

This is not optional for a deployment. A container's filesystem is replaced on
every restart and every deploy, so a prescription issued on Monday would have
lost its photographs by Tuesday and the QR code the patient took home would
resolve to broken images, with nothing on screen to say why. See ADR 050.

**One setting that is easy to miss:** the bucket's **Settings > CORS policy**
must allow the Netlify origin for `GET`. Playback does not need it, because a
`<video src>` works cross origin. Saving a prescription for offline replay
does, because that goes through `fetch()`, and without CORS headers it fails
and the screen honestly reports "Saved 0 of 4 sign clips". It is the one part
of FR 6.2 that breaks quietly.

If you already have clips imported on a laptop, upload them once:

```bash
cd backend && . .venv/bin/activate
python manage.py upload_media
```

Idempotent, so it is safe to re-run after filming more footage.

---

## 2. Render, the backend

**New > Web Service**, connect this repository.

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Runtime | Docker |
| Dockerfile Path | `./Dockerfile` |
| Health Check Path | `/api/health/` |
| Instance Type | Free |

Add a **PostgreSQL** instance in the same dashboard and use its internal
connection string as `DATABASE_URL`.

### Environment variables

| Variable | Value | Why |
| --- | --- | --- |
| `DJANGO_DEBUG` | `0` | Debug pages leak settings and stack traces |
| `DJANGO_SECRET_KEY` | a long random string | Render will generate one |
| `DJANGO_SECURE_SSL` | `1` | Redirects to https and marks cookies secure |
| `DJANGO_ALLOWED_HOSTS` | `your-site.netlify.app` | The Render hostname is added automatically |
| `CORS_ALLOWED_ORIGINS` | `https://your-site.netlify.app` | **With the scheme** |
| `CSRF_TRUSTED_ORIGINS` | `https://your-site.netlify.app` | **With the scheme** |
| `DATABASE_URL` | from the Render database | |
| `R2_ACCOUNT_ID` | from Cloudflare | |
| `R2_BUCKET` | from Cloudflare | |
| `R2_ACCESS_KEY_ID` | from Cloudflare | |
| `R2_SECRET_ACCESS_KEY` | from Cloudflare | Shown once when the token is made |
| `R2_PUBLIC_HOST` | `pub-xxxxxxxx.r2.dev` | Host only, no scheme, no trailing slash |
| `LANGUAGE_PROVIDER` | `stub` | See the note below before changing this |
| `KHAYA_API_KEY` | your key | Only needed when the line above is `khaya` |
| `DJANGO_SUPERUSER_USERNAME` | a name | The admin account, created on first start |
| `DJANGO_SUPERUSER_PASSWORD` | a long password | Checked against Django's validators |
| `DJANGO_SUPERUSER_EMAIL` | optional | |

**The scheme matters in the two origin variables.** Django ignores a bare
hostname there silently, so the setting looks configured and does nothing.

**`LANGUAGE_PROVIDER` decides whether real credit is spent.** Khaya's free tier
is metered, and `auto` picks the real provider whenever a key is present. Left
on `stub`, the app runs completely and says so on screen: captions are
untranslated and spoken answers are silence, both labelled as such rather than
passed off as working. That is ADR 011, and it is the honest state to demo in
until you want to spend credit deliberately.

**The admin account has to come from the environment.** It is how a GhSL
consultant approves clips, and an unapproved clip never plays, so a deployment
with no way into the admin has a clip library nobody can manage.
`createsuperuser` wants a terminal and the free tier has no shell, so
`ensure_superuser` reads these variables on start instead.

It only ever creates. An account that already exists is left alone, so a
password changed in the admin survives a redeploy. To reset a forgotten one,
set `DJANGO_SUPERUSER_FORCE_RESET=1`, redeploy, then unset it: that is the only
recovery route on a platform with no shell, and left set it resets the password
every time.

A password Django's validators refuse is reported in the deploy log and no
account is made. The service still starts, because refusing to boot would take
a working consultation screen down over a password.

### What happens on deploy

`backend/entrypoint.sh` runs migrations, creates the admin account if it is
missing, then starts gunicorn bound to `$PORT`. Nothing needs running by hand.

Two things are handled for you, both of which fail confusingly when they are
not. The port comes from the platform, because a server bound to a fixed 8000
is one Render cannot reach: the deploy succeeds, the health check times out,
and the logs show a happy gunicorn talking to nobody. And the service's own
hostname is added to `ALLOWED_HOSTS` from `RENDER_EXTERNAL_HOSTNAME`, because
it does not exist until the first deploy, and without it every request returns
`DisallowedHost` including Render's own health check, so the deploy is rolled
back before a log line explains it.

---

## 3. Netlify, the frontend

**Add new site > Import an existing project**, same repository. `netlify.toml`
supplies the settings, so the form should already show:

| Setting | Value |
| --- | --- |
| Base directory | `frontend` |
| Build command | `npm run build` |
| Publish directory | `dist` |

### Environment variables

| Variable | Value |
| --- | --- |
| `API_PROXY_TARGET` | `https://your-service.onrender.com` |

One, and it is the Render address from step 2. No trailing slash is needed;
one is stripped if present.

The app calls `/api/...` relative to itself, exactly as it does in
development, and the build writes redirects proxying `/api`, `/admin` and
`/static` to that address. The browser therefore sees a single origin: no CORS
preflight on every request, no second origin to keep in the Django settings,
and no backend URL compiled into the bundle.

The rules are generated into `dist/_redirects` by
`frontend/tools/write-redirects.mjs` rather than written in `netlify.toml`,
because that file is parsed statically and does not substitute environment
variables. A rule written there would put the backend's address in the
repository, and moving the backend would mean a commit rather than a setting.

A build without the variable still produces a working site with no proxy,
which is what `npm run build` does on a laptop and in CI. It says so on
stdout rather than omitting the rules silently, because a deploy missing the
variable would otherwise look fine until the first request failed.

---

## 4. Back to Render

Now that the Netlify domain exists, set the three variables that needed it:

```
DJANGO_ALLOWED_HOSTS=your-site.netlify.app
CORS_ALLOWED_ORIGINS=https://your-site.netlify.app
CSRF_TRUSTED_ORIGINS=https://your-site.netlify.app
```

---

## Checking it worked

```bash
curl https://your-site.netlify.app/api/health/
```

Expect `{"status": "ok", "database": "ok", "migrations": "ok"}`.

That endpoint touches the database rather than returning a hardcoded 200, so a
green answer means the whole path works. `"migrations": "pending"` means the
schema is behind the code, which is the failure ADR 045 exists for.

Then open the site itself and check three things a health check cannot:

- The literacy screen loads and the sign video plays, which proves the clips
  are being served from R2.
- The Django admin at `/admin/` accepts a login, which proves the CSRF origins
  are right.
- A prescription issues and its QR code resolves, which proves the whole chain.

---

## What the free tier does

**The backend sleeps after about 15 minutes** of no traffic and takes 30 to 60
seconds to wake. On a demo that is fatal: a judge taps and nothing happens.
Open the app yourself a minute beforehand.

**Stitching is CPU work on a shared instance**, so the first prescription is
slow. Every later one for the same medicines is served from the cache in R2,
because the filename is a hash of the clips it contains, so opening each
prescription once ahead of time is enough.

**The frontend does not sleep.** Netlify serves it from a CDN, so the patient
facing half is instant even while the backend is cold.

---

## Secrets

The Khaya key and the R2 credentials go in the platform's own environment
settings and in `backend/.env`, which is gitignored. **Never in
`backend/.env.example`,** which is tracked: that file is the template, and a
real key in it is a key published to everyone who clones the repository.

If a key is ever committed, rotating it is the fix. Removing it from the
working tree is not, because it stays in the history.
