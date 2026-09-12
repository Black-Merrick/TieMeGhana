# Drop filmed GhSL clips here

Put recorded sign videos in this folder, then import them. The video files
themselves are gitignored, because they are large binaries that do not belong
in the repository. Only this README is tracked.

## Naming

**One file per sign, named after its English gloss.** The filename is the
lookup key, so it has to match the word the caption will contain.

```
head.webm       -> gloss HEAD, a word sign
hurt.mp4        -> gloss HURT, a word sign
a.webm          -> gloss A, a fingerspelling letter
cannot_breathe.webm -> gloss CANNOT_BREATHE
```

Case does not matter, the gloss is stored uppercase either way.

A **single character** filename is imported as a fingerspelling letter rather
than a word sign, which is what FR 1.6's fallback needs. Everything longer is
imported as a word sign.

Accepted formats are `.webm`, `.mp4`, `.m4v`, and `.mov`. These are what a
browser can play in a `<video>` element without transcoding.

## Importing

Nothing watches this folder on its own, so a clip sits here until an import is
asked for. Three ways to ask:

```bash
cd backend
source .venv/bin/activate

python manage.py import_clips footage/            # once
python manage.py import_clips footage/ --watch    # keep running, for filming
```

Or press **Import footage folder** on the clip list in the Django admin, at
`/admin/clips/signclip/`. That is the one to use in a hospital, where the
person adding footage will not have a terminal.

All three share the same code path, and all three are safe to repeat: a file
whose contents are already stored is left completely alone, approval included.
See ADR 035.

Imported footage is **not usable yet**. It is filmed but unapproved, because
approval means a GhSL fluent consultant has vouched for the sign, and no script
can do that. Check what the library still needs:

```bash
python manage.py seed_clips --report
```

## Approving

Either approve individually in the Django admin, at `/admin/clips/signclip/`,
which is the normal path because a consultant reviews clip by clip. Or, once
someone has reviewed a whole batch, record that in one step:

```bash
python manage.py import_clips footage/ --approve --reviewer "Their Name, GhSL"
```

`--approve` requires `--reviewer`. An approval with nobody's name against it is
not a review.

## Re-importing a correction

Replacing a file with different contents resets its approval to pending, on
purpose. The consultant approved the recording that was there before, not the
new one, so it has to be checked again.

Re-importing an **unchanged** file changes nothing, so leaving `--watch`
running or pressing the button twice cannot quietly un-approve reviewed
footage. The comparison is by file contents, not timestamp.

## Duration

Nothing reads playback length from the video file, because that would need
ffmpeg, which is deliberately not a runtime dependency, see ADR 008. Pass
`--duration-ms` if you want the estimated sequence duration to be accurate.
Playback itself does not need it, the player advances on each video's own end
event.
