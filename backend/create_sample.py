"""Create a synthetic test DICOM. The pixels are not a clinical chest image."""
from __future__ import annotations

import argparse
import io
from pathlib import Path

import numpy as np
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid


def synthetic_dicom_bytes() -> bytes:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.1.1"
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.ImplementationClassUID = generate_uid()
    ds = FileDataset(None, {}, file_meta=meta, preamble=b"\0" * 128)
    ds.SOPClassUID = meta.MediaStorageSOPClassUID
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.Modality = "DX"
    ds.BodyPartExamined = "CHEST"
    ds.ViewPosition = "PA"
    ds.PresentationIntentType = "FOR PRESENTATION"
    ds.PatientIdentityRemoved = "YES"
    ds.BurnedInAnnotation = "NO"
    ds.ImageType = ["DERIVED", "SECONDARY", "SYNTHETIC"]
    ds.SeriesDescription = "SYNTHETIC SOFTWARE TEST ONLY - NOT A PATIENT IMAGE"
    ds.Rows = ds.Columns = 256
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated = ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 0
    yy, xx = np.mgrid[-1:1:256j, -1:1:256j]
    # Smooth geometric patterns provide nonconstant pixels for software tests.
    # They do not represent anatomy and cannot be used to evaluate accuracy.
    pattern = 0.5 + 0.18 * np.cos(5 * xx) + 0.22 * np.sin(4 * yy) + 0.05 * xx * yy
    ds.PixelData = np.rint(np.clip(pattern, 0, 1) * 4095).astype("<u2").tobytes()
    buf = io.BytesIO()
    ds.save_as(buf, enforce_file_format=True)
    return buf.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New output path, for example /tmp/candex-synthetic.dcm")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Output already exists; choose a new path.")
    args.output.write_bytes(synthetic_dicom_bytes())
    print("Created a synthetic software-test DICOM at", args.output)
    print("This is not anatomy or a patient image. Any model scores are meaningless for accuracy or care.")


if __name__ == "__main__":
    main()
