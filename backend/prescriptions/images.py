"""
Taking a photograph of a medicine into the prescription, FR 6.1.

A patient who cannot read a drug name can still match a photograph to the box
in their hand, which makes the picture a better identifier than the word for
exactly the people this app exists for. It also removes the weakest link in the
signed prescription: a drug name has no sign and has to be fingerspelled letter
by letter, which is slow to watch and easy to lose.

Two things happen to every upload, and neither is optional.

The image is re-encoded rather than stored as it arrived. A photograph from a
phone carries EXIF metadata, and on a hospital device that metadata routinely
includes the GPS coordinates of the hospital, the make and model of the phone,
and the exact time it was taken. None of that belongs in a payload that a QR
code hands to anyone who scans it, per FR 6.4, and stripping it is a matter of
decoding the pixels and writing them out again.

And it is resized. A modern phone camera produces something around four
megabytes, which a patient would then download over a hospital connection to
look at a picture of a box. A long edge of 1200 pixels is more than enough to
recognise a packet.
"""

import io

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import InMemoryUploadedFile
from PIL import Image, UnidentifiedImageError

# Enough to read the printing on a packet, small enough to send to a phone.
MAX_EDGE = 1200

# Re-encoded to JPEG whatever arrives, so there is one format to serve and one
# to decode. Quality 82 is where a photograph of a box stops getting visibly
# better and keeps getting bigger.
JPEG_QUALITY = 82

# Refused before decoding. A file this size is either not a photograph or is a
# camera raw, and either way decoding it to find out is work done on behalf of
# whoever sent it.
MAX_UPLOAD_BYTES = 12 * 1024 * 1024


def clean_medicine_image(upload):
    """
    Validate, strip and shrink an uploaded medicine photograph.

    Returns a new file ready to be saved. Raises `ValidationError` when the
    upload is not an image at all, which is the one case the caller has to
    report rather than quietly accept: a prescription with a broken picture and
    no drug name identifies nothing.
    """
    if upload.size > MAX_UPLOAD_BYTES:
        raise ValidationError(
            "That image is too large. Take the photograph again, or choose a "
            "smaller file."
        )

    try:
        # Verified on a separate handle. `verify()` leaves the image unusable
        # for reading pixels afterwards, which is a trap worth naming: the
        # obvious code verifies and then loads the same object, and gets an
        # exception that reads like a corrupt file.
        Image.open(upload).verify()
        upload.seek(0)
        image = Image.open(upload)
        image.load()
    except (UnidentifiedImageError, OSError) as error:
        raise ValidationError(
            "That file is not an image the app can read. Take a photograph of "
            "the medicine, or type the name instead."
        ) from error

    # Applied before anything else, because a phone writes the orientation into
    # EXIF rather than into the pixels, and dropping EXIF without applying it
    # first is how an upright photograph ends up on its side.
    image = _apply_orientation(image)

    # A photograph has no useful transparency, and JPEG has no way to keep it.
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)

    # A fresh image built from the pixels alone. Copying the object would carry
    # its `info` dictionary, EXIF included, straight into the saved file.
    stripped = Image.new(image.mode, image.size)
    stripped.putdata(list(image.getdata()))

    buffer = io.BytesIO()
    stripped.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    buffer.seek(0)

    return InMemoryUploadedFile(
        buffer,
        field_name="image",
        name="medicine.jpg",
        content_type="image/jpeg",
        size=buffer.getbuffer().nbytes,
        charset=None,
    )


def _apply_orientation(image):
    """
    Rotate the pixels to match the camera's EXIF orientation tag.

    Pillow ships `ImageOps.exif_transpose` for this, which is used rather than
    reading the tag by hand: the mapping from tag value to transform includes
    mirrored cases that are easy to get subtly wrong and hard to notice.
    """
    from PIL import ImageOps

    try:
        return ImageOps.exif_transpose(image)
    except Exception:  # noqa: BLE001
        # A malformed orientation tag is not a reason to reject a photograph
        # the patient needs. Worst case it is shown as the camera stored it.
        return image
