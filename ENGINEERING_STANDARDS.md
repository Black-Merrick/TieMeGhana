# Tie Me Ghana, Engineering Standards and Build Workflow

This is what turns a hackathon build into something that reads as
deliberately engineered rather than assembled quickly. None of this is
extra bureaucracy for its own sake, each piece exists to catch a specific
kind of mistake before a judge or a real user does.

---

## 1. What "not vibe coded" actually means, concretely

A judge or reviewer forms an impression of engineering discipline from a
small number of visible signals. These are the ones worth deliberately
getting right:

- Every function and component does one clearly named thing, not three
  things bundled together because it was faster to write that way
- Every model, serializer, and non obvious function has a short comment
  explaining why it exists, not just what it does
- No leftover console.log, print statement, or commented out dead code
  in anything committed to the repository
- Every feature has at least one real test that would fail if the
  feature broke, not a placeholder test that always passes
- Commit messages describe what changed and why, not "fix" or "update"
- Formatting is consistent because a tool enforces it, not because
  everyone tried to remember the style guide

Sections 2 through 5 below are how you enforce this automatically,
rather than relying on willpower during a time pressured sprint.

---

## 2. One time setup, do this before writing any new feature code

```bash
cd backend
pip install -r requirements-dev.txt
pre-commit install
```

From the project root:
```bash
pip install pre-commit   # if not already available globally
pre-commit install
```

This means every `git commit` from now on automatically runs Black,
isort, and Ruff on your Python files, and ESLint on your JS/JSX files,
before the commit is allowed to complete. A commit with inconsistent
formatting or an obvious lint error simply will not go through, this is
what "enforced automatically" means in practice.

---

## 3. The step by step workflow for every new feature

Follow this same sequence for every feature from here forward, whether
it is something already scoped in the SRS or something new.

**Step 1, write the failing test first, or immediately after the
smallest possible implementation.** For a backend feature, write the
test in the relevant app's `tests.py` describing the behavior you want,
run it, watch it fail because the feature doesn't exist yet.

**Step 2, write the minimum code to make that test pass.** Not the
complete feature, the smallest version that satisfies the test.

**Step 3, run the full test suite, not just your new test.**
```bash
cd backend
pytest
```
This catches the case where your new code accidentally broke something
unrelated, which is exactly the kind of mistake that makes a project
feel unstable under judging.

**Step 4, run formatting and linting.**
```bash
black .
isort .
ruff check . --fix
```
If `pre-commit` is installed per Section 2, this happens automatically
on commit, but running it manually while developing catches issues
earlier.

**Step 5, commit with a message describing the actual change.**
```bash
git add .
git commit -m "Add Guided Interrogation answer submission endpoint with tests"
```
Not `git commit -m "update"`.

**Step 6, push and let CI confirm it independently.**
```bash
git push
```
The GitHub Actions workflow in `.github/workflows/ci.yml` re runs every
test and lint check in a clean environment, this is what proves the
feature actually works, not just "works on my machine."

Repeat this cycle for every feature, in priority order, per the P0, P1,
P2 breakdown in the SRS.

---

## 4. Testing philosophy, what to actually test

Not everything needs a test, and testing everything indiscriminately is
its own kind of wasted effort under time pressure. Prioritize tests for:

- **Model behavior with real consequences**, for example, that deleting
  a Question also deletes its AnswerOptions, since an orphaned row would
  silently corrupt the Guided Interrogation flow
- **API contracts your frontend depends on**, for example, that
  `/api/questions/` returns answer options nested inside each question,
  since your frontend code assumes that exact shape
- **Design decisions that matter for the pitch**, for example, the test
  confirming clips cannot be created through the API, which locks in
  your stated design that clips are admin managed only
- **The literacy branching logic specifically**, since this is the
  single most important behavioral distinction in the whole app, a
  regression here would silently break accessibility for exactly the
  users the project exists to serve

Skip writing tests for simple pass through code with no real logic, for
example, a serializer with no custom validation, that would be testing
Django itself, not your code.

---

## 5. Docker, two separate compose files, for two separate purposes

**`docker-compose.yml`** (already in your project root): PostgreSQL
only, for day to day local development. Django and React run natively
for fast reload cycles, per SETUP_GUIDE.md.

**`docker-compose.full.yml`** (new, in this scaffold): the entire stack
containerized, backend, frontend, and database. Use this for:
- Confirming the app works the way it will run in a real deployment
- CI environments, if you extend the pipeline to run integration tests
  against the full stack rather than just unit tests
- An actual staging or production deployment later

To run the full stack version:
```bash
docker compose -f docker-compose.full.yml up --build
```

Do not use `docker-compose.full.yml` for daily development, rebuilding
containers on every code change is far slower than native hot reload.

---

## 6. What's in this scaffold, file by file

```
your-project-root/
├── .github/workflows/ci.yml       <- runs on every push and PR
├── .pre-commit-config.yaml        <- enforces formatting on every commit
├── docker-compose.full.yml        <- full stack, for staging or CI
├── backend/
│   ├── pyproject.toml             <- Black, isort, Ruff, pytest config
│   ├── requirements-dev.txt       <- testing and linting tools
│   ├── conftest.py                <- shared pytest fixtures
│   ├── Dockerfile                 <- production backend image
│   ├── clips/tests.py             <- real tests, model + API behavior
│   ├── questions/tests.py         <- real tests, including cascade delete
│   ├── patients/tests.py          <- real tests, literacy branching
│   └── sessions_log/tests.py      <- real tests, transcript ordering
└── frontend/
    ├── Dockerfile                 <- production frontend image (nginx)
    ├── PACKAGE_JSON_ADDITIONS.txt <- what to add to your existing package.json
    └── src/
        ├── components/GuidedInterrogation.jsx   <- real component
        └── __tests__/GuidedInterrogation.test.jsx <- real test for it
```

---

## 7. Immediate next action

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

Run this now, before writing anything new. It should pass against the
models from the previous scaffold, confirming your baseline is solid
before you build on top of it.
