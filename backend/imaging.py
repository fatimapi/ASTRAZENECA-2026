"""Decode a constrained frontal chest radiograph without returning DICOM metadata."""
from __future__ import annotations

import base64
import io
import struct
import warnings
from dataclasses import dataclass

import numpy as np
import pydicom
from PIL import Image
from pydicom.errors import InvalidDicomError
from pydicom.pixels import apply_modality_lut, apply_voi_lut

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 16_000_000
SUPPORTED_SOPS = {
    "1.2.840.10008.5.1.4.1.1.1": "CR",  # Computed Radiography Image Storage
    "1.2.840.10008.5.1.4.1.1.1.1": "DX",  # Digital X-Ray, For Presentation
}
UNCOMPRESSED_TRANSFER_SYNTAXES = {
    "1.2.840.10008.1.2",  # Implicit VR Little Endian
    "1.2.840.10008.1.2.1",  # Explicit VR Little Endian
    "1.2.840.10008.1.2.2",  # Explicit VR Big Endian
}


class ImageRejected(ValueError):
    """A safe explanation that does not contain source metadata."""


def _check_transfer_syntax(content: bytes) -> None:
    """Inspect bounded Part 10 file meta before pydicom can inflate a dataset.

    File meta is always explicit-VR little endian, even when the dataset is not.
    Reject all compressed/deflated transfer syntaxes in this initial pipeline.
    """
    if len(content) < 144 or content[128:132] != b"DICM":
        raise ImageRejected("The file is not a readable DICOM Part 10 image.")
    offset, syntax = 132, None
    known_vrs = {value.encode("ascii") for value in "AE AS AT CS DA DS DT FD FL IS LO LT OB OD OF OL OV OW PN SH SL SQ SS ST SV TM UC UI UL UN UR US UT UV".split()}
    long_vrs = {b"OB", b"OD", b"OF", b"OL", b"OV", b"OW", b"SQ", b"SV", b"UC", b"UR", b"UT", b"UN", b"UV"}
    while offset + 8 <= len(content):
        if offset > 65536:
            raise ImageRejected("The DICOM file meta exceeds the supported 64 KiB limit.")
        group, element = struct.unpack_from("<HH", content, offset)
        if group != 2:
            break
        vr = content[offset + 4:offset + 6]
        if vr not in known_vrs:
            raise ImageRejected("The DICOM file meta contains an invalid explicit value representation.")
        if vr in long_vrs:
            if offset + 12 > len(content):
                raise ImageRejected("The DICOM file meta is truncated.")
            if content[offset + 6:offset + 8] != b"\0\0":
                raise ImageRejected("The DICOM file meta contains invalid reserved bytes.")
            length = struct.unpack_from("<I", content, offset + 8)[0]
            start = offset + 12
        else:
            length = struct.unpack_from("<H", content, offset + 6)[0]
            start = offset + 8
        end = start + length
        if end > min(len(content), 65536) or length == 0xFFFFFFFF:
            raise ImageRejected("The DICOM file meta exceeds the supported size or is incomplete.")
        if element == 0x0010:
            if vr != b"UI" or syntax is not None:
                raise ImageRejected("The DICOM transfer syntax metadata is invalid.")
            try:
                syntax = content[start:end].decode("ascii").strip("\0 ")
            except UnicodeDecodeError:
                raise ImageRejected("The DICOM transfer syntax metadata is invalid.") from None
        offset = end
    if syntax not in UNCOMPRESSED_TRANSFER_SYNTAXES:
        raise ImageRejected("Only uncompressed DICOM transfer syntaxes are supported. Compressed and deflated studies must be exported as uncompressed research images.")


@dataclass(frozen=True)
class PreparedImage:
    pixels_255: np.ndarray
    width: int
    height: int
    modality: str
    preview_png_base64: str


def _prepare_dicom(content: bytes, confirmed_chest: bool) -> PreparedImage:
    if not content or len(content) > MAX_FILE_BYTES:
        raise ImageRejected("Choose a DICOM file no larger than 20 MiB.")
    if not confirmed_chest:
        raise ImageRejected("Confirm this is a frontal chest X-ray before analysis.")
    _check_transfer_syntax(content)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ds = pydicom.dcmread(io.BytesIO(content), force=False)
    except (InvalidDicomError, ValueError, EOFError, OSError):
        raise ImageRejected("The file is not a readable DICOM Part 10 image.") from None

    try:
        modality = str(ds.get("Modality", "")).upper()
        sop = str(ds.get("SOPClassUID", ""))
        if modality not in {"CR", "DX"} or SUPPORTED_SOPS.get(sop) != modality:
            raise ImageRejected("Only CR/DX chest X-ray DICOM images are supported. CT, MR and other studies require a different model.")
        if str(ds.get("PresentationIntentType", "FOR PRESENTATION")) != "FOR PRESENTATION":
            raise ImageRejected("Use a DICOM image prepared for presentation, not raw acquisition data.")
        if int(ds.get("NumberOfFrames", 1)) != 1:
            raise ImageRejected("Multi-frame images are not supported. Select one frontal chest X-ray.")
        if int(ds.get("SamplesPerPixel", 1)) != 1 or str(ds.get("PhotometricInterpretation", "")) not in {"MONOCHROME1", "MONOCHROME2"}:
            raise ImageRejected("Only single-channel monochrome DICOM images are supported.")
        rows, cols = int(ds.Rows), int(ds.Columns)
        if rows < 32 or cols < 32 or rows * cols > MAX_PIXELS:
            raise ImageRejected("Image dimensions must be at least 32 × 32 and at most 16 million pixels.")
        if int(ds.get("BitsAllocated", 0)) not in {8, 16}:
            raise ImageRejected("Only 8-bit or 16-bit radiographs are supported.")
        view = str(ds.get("ViewPosition", "")).strip().upper()
        if view not in {"AP", "PA"}:
            raise ImageRejected("Only frontal AP/PA chest X-rays with a ViewPosition tag are supported; lateral or unknown views are excluded.")
        body = str(ds.get("BodyPartExamined", "")).strip().upper()
        if body and body not in {"CHEST", "THORAX", "LUNG", "LUNGS"}:
            raise ImageRejected("The DICOM body-part tag does not identify a chest image.")
        if str(ds.get("BurnedInAnnotation", "NO")).upper() == "YES":
            raise ImageRejected("The image declares burned-in annotations. Use an appropriately de-identified research image.")
        if "PixelData" not in ds:
            raise ImageRejected("The DICOM contains no image pixels.")
        # Shape and bit depth are checked before decompression/allocation.
        try:
            pixels = ds.pixel_array
        except Exception:
            raise ImageRejected("DICOM pixels could not be decoded. Export a valid uncompressed research image.") from None
        if pixels.shape != (rows, cols):
            raise ImageRejected("The decoded image shape does not match its DICOM header.")
        windowed = "VOILUTSequence" in ds or ("WindowCenter" in ds and "WindowWidth" in ds)
        linear = str(ds.get("VOILUTFunction", "LINEAR") or "LINEAR").upper() == "LINEAR"
        if "ModalityLUTSequence" not in ds and "VOILUTSequence" not in ds and linear:
            # Common case, in float32 and in place (a large radiograph used ~200 MB in float64): rescale slope/
            # intercept, then the DICOM linear window as a clip. The window's own linear output scaling is not
            # applied because the min-max normalisation below removes it; the result equals pydicom's up to
            # float32 rounding.
            pixels = pixels.astype(np.float32)
            slope, intercept = float(ds.get("RescaleSlope", 1) or 1), float(ds.get("RescaleIntercept", 0) or 0)
            if slope != 1:
                pixels *= np.float32(slope)
            if intercept:
                pixels += np.float32(intercept)
            if windowed:
                first = lambda v: float(v[0] if isinstance(v, (list, tuple)) or type(v).__name__ == "MultiValue" else v)
                centre, width = first(ds.WindowCenter), first(ds.WindowWidth)
                if width >= 1:
                    np.clip(pixels, centre - 0.5 - (width - 1) / 2, centre - 0.5 + (width - 1) / 2, out=pixels)
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                pixels = np.asarray(apply_modality_lut(pixels, ds), dtype=np.float64)
                if windowed:
                    pixels = np.asarray(apply_voi_lut(pixels, ds, index=0), dtype=np.float64)
        if not np.isfinite(pixels).all():
            raise ImageRejected("The image contains non-finite pixel values.")
        low, high = float(pixels.min()), float(pixels.max())
        if high <= low:
            raise ImageRejected("The image has no usable pixel-intensity range.")
        # A display window that pins most pixels to black or white (for example a
        # CT lung window stored on a radiograph) would be scored as a blank image.
        if windowed:
            clipped = float(np.mean((pixels <= low) | (pixels >= high)))
            if clipped > 0.5:
                raise ImageRejected(f"The DICOM display window clips {clipped:.0%} of the image to black or white, so it cannot be analysed reliably. Check WindowCenter and WindowWidth.")
        # Same arithmetic as before, in place (float64), so the full-size image is not copied several times.
        if not pixels.flags.writeable or not pixels.flags.owndata:
            pixels = pixels.copy()
        pixels -= low
        pixels /= (high - low)
        np.clip(pixels, 0.0, 1.0, out=pixels)
        if str(ds.PhotometricInterpretation) == "MONOCHROME1":
            np.subtract(1.0, pixels, out=pixels)
        pixels *= 255.0
        scaled = pixels.astype(np.float32)
        del pixels
        preview = Image.fromarray(np.rint(scaled).astype(np.uint8), mode="L")
        preview.thumbnail((1024, 1024))
        buf = io.BytesIO()
        preview.save(buf, format="PNG")
        return PreparedImage(scaled, cols, rows, modality, base64.b64encode(buf.getvalue()).decode("ascii"))
    except ImageRejected:
        raise
    except Exception:
        raise ImageRejected("The DICOM image header or presentation settings are unsupported.") from None


def prepare_dicom(content: bytes, confirmed_chest: bool) -> PreparedImage:
    # pydicom can decode deferred tags during validation, not just dcmread.
    # Never emit raw source-tag warnings into terminal logs.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return _prepare_dicom(content, confirmed_chest)
