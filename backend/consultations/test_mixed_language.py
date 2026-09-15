"""
Code switching: one utterance containing both English and Twi.

How clinical speech in Ghana actually works. Much medical vocabulary has no
Twi word, plenty of Twi has no single English one, and a speaker moves between
them inside a sentence. Forcing a choice between "English" and "Twi" made the
doctor declare something untrue, and the system then acted on it confidently:
"Fa paracetamol mmienu" declared as Twi went to the translator whole and came
back fluent and wrong, with nothing on screen to suggest it.

`MIXED` is that declaration. It is about the input only, and it is handled by
*not* translating, which is a deliberate design rather than a gap: there is no
`mixed-tw` direction to ask for, and splitting the sentence first would need a
Twi lexicon the project does not have. What the project does have is the ADR
033 safety gate, which already reports a content word it cannot sign rather
than dropping it, so the doctor is told exactly which words did not make it.
"""

import io

import pytest
from django.urls import reverse

from core.language import Language, LanguageError
from core.language.khaya import KhayaLanguageProvider


@pytest.fixture
def mixed_vocabulary(make_clip):
    """English clips only, which is what the library is keyed on."""
    for gloss in ("TAKE", "TWO", "TABLET", "AFTER", "FOOD"):
        make_clip(gloss)


@pytest.mark.django_db
class TestACaptionThatMixesLanguages:
    def test_the_words_are_shown_as_the_doctor_wrote_them(
        self, api_client, mixed_vocabulary
    ):
        response = api_client.post(
            reverse("caption"),
            {"source_language": "mixed", "text": "Take two tablet after food"},
            format="json",
        )

        assert response.status_code == 200
        body = response.json()
        assert body["caption"] == "Take two tablet after food"
        assert body["translation_applied"] is False

    def test_the_caption_is_not_labelled_as_twi(self, api_client, mixed_vocabulary):
        # The interface labels the caption from this field. Calling untranslated
        # text Twi is how a patient comes to trust a caption nobody translated.
        response = api_client.post(
            reverse("caption"),
            {"source_language": "mixed", "text": "Take two tablet after food"},
            format="json",
        )

        assert response.json()["caption_language"] == "mixed"

    def test_signs_still_resolve_for_the_english_words(
        self, api_client, mixed_vocabulary
    ):
        response = api_client.post(
            reverse("caption"),
            {"source_language": "mixed", "text": "Take two tablet after food"},
            format="json",
        )

        matches = {
            segment["token"]: segment["match"]
            for segment in response.json()["sequence"]["segments"]
        }
        assert matches["take"] == "gloss"
        assert matches["tablet"] == "gloss"

    def test_a_twi_word_is_reported_rather_than_silently_dropped(
        self, api_client, mixed_vocabulary, alphabet
    ):
        # The safety gate doing its job. "aduro" has no English gloss, so it
        # cannot be signed, and the doctor has to know that before this is
        # shown to a patient rather than after.
        response = api_client.post(
            reverse("caption"),
            {"source_language": "mixed", "text": "Take aduro after food"},
            format="json",
        )

        sequence = response.json()["sequence"]
        reported = set(
            sequence["unavailable_tokens"]
            + sequence["blocking_tokens"]
            + sequence["fingerspelled_tokens"]
        )
        assert "aduro" in reported, sequence


@pytest.mark.django_db
class TestMixedSpeechIsRefused:
    """
    Speech recognition runs one language at a time. There is no model to ask
    for a sentence that switches, so this is refused with the reason.
    """

    def test_audio_declared_as_mixed_is_rejected(self, api_client):
        audio = io.BytesIO(b"pretend-this-is-webm")
        audio.name = "utterance.webm"

        response = api_client.post(
            reverse("caption"),
            {"source_language": "mixed", "audio": audio},
            format="multipart",
        )

        assert response.status_code == 400

    def test_the_refusal_says_what_to_do_instead(self, api_client):
        # Mid consultation, "invalid" is useless. The doctor needs to know they
        # can type it or pick a language.
        audio = io.BytesIO(b"pretend-this-is-webm")
        audio.name = "utterance.webm"

        response = api_client.post(
            reverse("caption"),
            {"source_language": "mixed", "audio": audio},
            format="multipart",
        )

        message = str(response.json())
        assert "type" in message.lower()
        assert "one language at a time" in message


@pytest.mark.django_db
class TestSpeakingAMixedAnswer:
    def test_a_mixed_answer_is_spoken_as_written(self, api_client):
        response = api_client.post(
            reverse("speak"),
            {
                "text": "Me ho ye but my head is paining me",
                "source_language": "mixed",
                "output_language": "en",
            },
            format="json",
        )

        assert response.status_code == 200
        body = response.json()
        assert body["spoken_text"] == "Me ho ye but my head is paining me"
        assert body["translation_applied"] is False

    def test_mixed_is_refused_as_an_output_voice(self, api_client):
        # The output language picks the voice, and there is no mixed voice.
        # Accepting one would mean choosing English or Twi arbitrarily and
        # reporting whichever was chosen as though it had been asked for.
        response = api_client.post(
            reverse("speak"),
            {
                "text": "My head is paining me",
                "source_language": "en",
                "output_language": "mixed",
            },
            format="json",
        )

        assert response.status_code == 400
        assert "output_language" in response.json()


class TestMixedNeverReachesTheMeteredApi:
    """
    The backstop, because this mistake costs money and clinical trust.

    Every language argument is interpolated straight into Khaya's request, so a
    `MIXED` that slipped through would go out as "mixed" or "mixed-tw": a
    metered call on a free tier that either errors mid consultation or returns
    a confident 200 nobody can tell from real Twi.
    """

    @pytest.fixture
    def khaya(self, monkeypatch):
        """
        A real provider whose transport is wired to explode.

        Wired that way deliberately. These tests assert that a guard prevents
        an HTTP call, and if the guard ever broke, a test written without this
        would make the exact metered request it exists to prevent, against
        whatever key is in the environment. The suite would go red either way;
        only one of the two costs credit to find out.
        """
        provider = KhayaLanguageProvider(api_key="not-used-no-request-is-made")
        monkeypatch.setattr(
            provider,
            "_request",
            lambda *args, **kwargs: pytest.fail(
                "A Khaya request was attempted. The mixed language guard has "
                "stopped working, and this would have spent metered credit."
            ),
        )
        return provider

    def test_translating_from_mixed_is_refused(self, khaya):
        with pytest.raises(LanguageError, match="mixes English and Twi"):
            khaya.translate("anything", source=Language.MIXED, target=Language.TWI)

    def test_translating_into_mixed_is_refused(self, khaya):
        with pytest.raises(LanguageError, match="mixes English and Twi"):
            khaya.translate("anything", source=Language.ENGLISH, target=Language.MIXED)

    def test_transcribing_mixed_is_refused(self, khaya):
        with pytest.raises(LanguageError, match="mixes English and Twi"):
            khaya.transcribe(b"audio", language=Language.MIXED)

    def test_synthesizing_mixed_is_refused(self, khaya):
        with pytest.raises(LanguageError, match="mixes English and Twi"):
            khaya.synthesize("anything", language=Language.MIXED)

    def test_real_languages_still_reach_the_transport(self, khaya, monkeypatch):
        # The other half of the guard: it must refuse `MIXED` without also
        # blocking the languages the provider exists to serve.
        monkeypatch.setattr(khaya, "_request", lambda *args, **kwargs: None)
        monkeypatch.setattr(
            KhayaLanguageProvider, "_read_text", staticmethod(lambda response: "ok")
        )

        assert (
            khaya.translate("hello", source=Language.ENGLISH, target=Language.TWI)
            == "ok"
        )


class TestTheLanguageEnum:
    def test_mixed_is_not_a_provider_language(self):
        assert Language.MIXED.is_provider_language is False

    def test_english_and_twi_are(self):
        assert Language.ENGLISH.is_provider_language
        assert Language.TWI.is_provider_language
