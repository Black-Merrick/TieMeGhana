"""
Warning about several workers with a per process cache.
"""

from django.core.checks import run_checks

from pairing.checks import pairing_needs_one_process_or_a_shared_cache, worker_count

LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
SHARED = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": "redis://x",
    }
}


def check(monkeypatch, settings, workers, caches):
    if workers is None:
        monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    else:
        monkeypatch.setenv("WEB_CONCURRENCY", str(workers))
    settings.CACHES = caches
    return pairing_needs_one_process_or_a_shared_cache(None)


def test_one_worker_is_fine(monkeypatch, settings):
    assert check(monkeypatch, settings, 1, LOCMEM) == []


def test_no_setting_means_one_worker(monkeypatch, settings):
    assert check(monkeypatch, settings, None, LOCMEM) == []


def test_several_workers_with_a_per_process_cache_are_warned_about(
    monkeypatch, settings
):
    found = check(monkeypatch, settings, 3, LOCMEM)

    assert [item.id for item in found] == ["pairing.W001"]
    assert "3" in found[0].msg
    assert "GUNICORN_THREADS" in found[0].hint


def test_several_workers_with_a_shared_cache_are_fine(monkeypatch, settings):
    assert check(monkeypatch, settings, 3, SHARED) == []


def test_a_nonsense_setting_is_read_as_one(monkeypatch):
    monkeypatch.setenv("WEB_CONCURRENCY", "many")

    assert worker_count() == 1


def test_it_is_part_of_the_project_checks(monkeypatch):
    monkeypatch.setenv("WEB_CONCURRENCY", "3")

    ids = [item.id for item in run_checks(tags=["caches"])]

    assert "pairing.W001" in ids
