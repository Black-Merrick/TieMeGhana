"""
The read paths issue a fixed number of queries, whatever the data size.

These are the tests that keep the reads fast, and they are about query *count*
rather than time. Measured against the deployed Neon database, a query executes
in 0.02 to 0.5ms while the network round trip to issue it costs about 240ms. So
the cost of a request is almost exactly the number of queries it makes, and an
N+1 that nobody notices locally against SQLite is a consultation screen that
takes seconds in a hospital.

Written as scaling assertions, not fixed numbers, wherever the count is the
thing at risk. A test that pins "6 queries" fails when someone adds a seventh
for a good reason, and gets updated without thought. A test that says the count
is the same for one medicine as for sixteen fails only when the property that
actually matters has broken.
"""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from clips.models import ClipKind


@pytest.fixture
def library(make_clip):
    """Enough vocabulary for the sequences below to resolve."""
    for gloss in (
        "ASK",
        "ABOUT",
        "FEELING",
        "TABLET",
        "ONE",
        "MORNING",
        "AFTER",
        "FOOD",
    ):
        make_clip(gloss)
    make_clip("HOW_ARE_YOU_DOING", kind=ClipKind.PHRASE)


def queries_for(call):
    """Run `call`, assert it succeeded, and return the queries it issued."""
    with CaptureQueriesContext(connection) as captured:
        response = call()

    assert response.status_code in (200, 201), response.status_code
    return captured.captured_queries


@pytest.mark.django_db
class TestThePrescriptionPlaylist:
    """
    What a scanned QR code reaches, FR 6.2. The one read whose payload grows:
    a prescription may carry any number of medicines, each needing its signs
    resolved.
    """

    def _playlist_queries(self, api_client, medicines):
        from prescriptions.models import Prescription, PrescriptionItem

        prescription = Prescription.objects.create()
        for position in range(medicines):
            PrescriptionItem.objects.create(
                prescription=prescription,
                position=position,
                medicine=f"Drug {position}",
                dosage="one tablet",
                frequency="morning, after food",
                caption="one tablet, morning, after food",
            )

        return queries_for(
            lambda: api_client.get(
                reverse("prescription-playlist", args=[prescription.reference])
            )
        )

    def test_the_query_count_does_not_grow_with_the_number_of_medicines(
        self, api_client, library
    ):
        # The N+1 this guards against would resolve each medicine's signs in
        # its own round trip. Sixteen medicines is not a realistic
        # prescription, which is the point: if the count is flat there, it is
        # flat everywhere below it.
        one = self._playlist_queries(api_client, 1)
        many = self._playlist_queries(api_client, 16)

        assert len(many) == len(one), (
            f"{len(one)} queries for one medicine but {len(many)} for sixteen, "
            "so something now resolves per item instead of in a batch:\n"
            + "\n".join(q["sql"][:160] for q in many)
        )

    def test_every_item_is_read_in_a_single_query(self, api_client, library):
        queries = self._playlist_queries(api_client, 4)
        item_queries = [
            q for q in queries if "prescriptions_prescriptionitem" in q["sql"]
        ]

        assert len(item_queries) == 1, (
            f"Expected every prescription item in one query, got "
            f"{len(item_queries)}. Something is reading items row by row."
        )

    # No test here asserting the view's `prefetch_related("items")`, and that
    # is deliberate rather than an omission. It was written, and it passed with
    # the prefetch removed, which makes it a test that cannot fail for the
    # reason it claims. `build_playlist` materialises `prescription.items.all()`
    # exactly once, so the count is two queries either way: with the prefetch
    # Django fetches items eagerly, without it the same `.all()` fetches them
    # lazily. The prefetch is harmless and worth keeping for the day something
    # reads items twice, but it is not currently saving a query, and a green
    # test implying otherwise is worse than no test.


@pytest.mark.django_db
class TestResolvingASignSequence:
    """
    The hot path, run on every exchange in a consultation.

    Every lookup it makes is a batch: phrases, words, aliases and letters are
    each fetched for the whole sentence at once rather than per token.
    """

    def test_the_query_count_does_not_grow_with_the_sentence(
        self, api_client, library, alphabet
    ):
        short = queries_for(
            lambda: api_client.post(
                reverse("sign-sequence"), {"text": "ask"}, format="json"
            )
        )
        long = queries_for(
            lambda: api_client.post(
                reverse("sign-sequence"),
                {"text": "ask about feeling tablet one morning after food"},
                format="json",
            )
        )

        assert len(long) == len(short), (
            f"{len(short)} queries for one word but {len(long)} for eight, so "
            "tokens are being looked up individually:\n"
            + "\n".join(q["sql"][:160] for q in long)
        )

    def test_fingerspelling_a_whole_unknown_word_is_still_one_lookup(
        self, api_client, library, alphabet
    ):
        # FR 1.6 spells out a word with no sign, letter by letter. The letters
        # must be fetched together: a five letter word doing five queries is
        # the easiest N+1 in the project to write by accident.
        short = queries_for(
            lambda: api_client.post(
                reverse("sign-sequence"), {"text": "zyx"}, format="json"
            )
        )
        long = queries_for(
            lambda: api_client.post(
                reverse("sign-sequence"), {"text": "zyxwvutsrq"}, format="json"
            )
        )

        assert len(long) == len(short)

    def test_aliases_arrive_with_their_clips(self, api_client, library, alphabet):
        # ADR 034. An alias is only usable together with its clip, so fetching
        # them separately would be a query per alias.
        from clips.models import ClipAlias, SignClip

        ClipAlias.objects.create(
            clip=SignClip.objects.get(gloss="FEELING"),
            term="DOING",
            reviewed_by="Test Consultant",
        )

        queries = queries_for(
            lambda: api_client.post(
                reverse("sign-sequence"), {"text": "doing"}, format="json"
            )
        )
        alias_queries = [q for q in queries if "clips_clipalias" in q["sql"]]

        assert len(alias_queries) == 1
        # The join, asserted rather than assumed: without select_related the
        # clip behind each alias is a second query.
        assert "clips_signclip" in alias_queries[0]["sql"], (
            "The alias lookup no longer joins its clip, so each alias costs an "
            "extra query."
        )


@pytest.mark.django_db
class TestTheClipLibraryList:
    """
    What the app requests on open to warm its media cache, and the one read
    whose result set grows with the whole library.
    """

    def test_one_query_however_many_clips_there_are(self, api_client, make_clip):
        for index in range(40):
            make_clip(f"FILLER_{index}")

        queries = queries_for(lambda: api_client.get(reverse("clip-list")))

        assert len(queries) == 1, "\n".join(q["sql"][:160] for q in queries)


@pytest.mark.django_db
class TestTheResolvableIndex:
    """
    The partial index exists and covers exactly the rows the resolver can use.

    Asserted because a partial index whose condition has drifted from
    `resolvable()` is worse than no index: it silently stops matching the query
    it was added for, and the only symptom is a plan nobody is looking at.
    """

    def test_it_matches_the_resolvable_queryset(self):
        from clips.models import SignClip

        index = next(
            i for i in SignClip._meta.indexes if i.name == "clip_resolvable_by_kind"
        )

        assert index.fields == ["kind", "gloss"]
        assert index.condition is not None, (
            "The index is no longer partial, so it now carries every unfilmed "
            "gloss waiting to be recorded."
        )
